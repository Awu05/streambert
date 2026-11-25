const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { proxyStream } = require("../src/ipc/streamProxy");
const { getStreamRequestMeta } = require("../src/ipc/streamRequestMeta");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function checkPlayback() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "streambert-hls-"));
  const servers = [];
  const windows = [];

  try {
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12",
      "-t", "8", "-an", "-c:v", "libx264", "-g", "12", "-sc_threshold", "0",
      "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod",
      "-hls_segment_type", "fmp4", "media.m3u8",
    ], { cwd: directory, timeout: 15000 });

    const files = new Set(fs.readdirSync(directory).map((name) => `/${name}`));
    files.add("/master.m3u8");
    let captured;
    let detached = false;
    const requested = new Set();
    const fixture = http.createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end('<script>fetch("/master.m3u8")</script>');
        return;
      }
      if (!files.has(req.url)) {
        res.writeHead(404).end();
        return;
      }
      if (detached) {
        if (
          req.headers.referer !== `${origin}/` ||
          req.headers.origin !== origin ||
          req.headers["user-agent"] !== captured?.userAgent
        ) {
          res.writeHead(403).end();
          return;
        }
        requested.add(req.url);
      }
      if (req.url === "/master.m3u8") {
        res.writeHead(302, { Location: "/hls/master.m3u8" }).end();
        return;
      }
      if (req.url === "/hls/master.m3u8") {
        res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
        res.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000\n../media.m3u8\n");
        return;
      }
      res.end(fs.readFileSync(path.join(directory, req.url.slice(1))));
    });
    files.add("/hls/master.m3u8");
    servers.push(fixture);
    const origin = await listen(fixture);
    const partition = session.fromPartition("persist:player");
    const source = new BrowserWindow({ show: false, webPreferences: { session: partition } });
    windows.push(source);
    const sourceId = source.webContents.id;
    const master = `${origin}/master.m3u8`;
    const capture = new Promise((resolve) => {
      partition.webRequest.onBeforeSendHeaders({ urls: ["*://*/*.m3u8"] }, (details, done) => {
        done({ requestHeaders: details.requestHeaders });
        if (details.webContentsId === sourceId && details.url === master) {
          resolve(getStreamRequestMeta(details));
        }
      });
    });
    await source.loadURL(origin);
    captured = await capture;
    assert.equal(captured.referer, `${origin}/`);
    assert.ok(captured.userAgent);
    source.destroy();
    detached = true;

    const hlsScript = fs.readFileSync(require.resolve("hls.js/dist/hls.min.js"));
    const player = http.createServer((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end('<video muted playsinline></video><script src="/hls.js"></script>');
      } else if (req.url === "/hls.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" }).end(hlsScript);
      } else if (files.has(req.url)) {
        proxyStream(`${origin}${req.url}`, req, res, {
          authorizeUrl: (value) => {
            const url = new URL(value);
            assert.equal(url.origin, origin);
            assert.ok(files.has(url.pathname));
            return url;
          },
          proxyUrl: (value) => new URL(value).pathname,
          getHeaders: () => ({
            Referer: captured.referer,
            Origin: captured.origin,
            "User-Agent": captured.userAgent,
          }),
        });
      } else {
        res.writeHead(404).end();
      }
    });
    servers.push(player);
    const viewer = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    windows.push(viewer);
    await viewer.loadURL(await listen(player));
    await viewer.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const video = document.querySelector("video");
      const hls = new Hls({ maxBufferLength: 2, maxMaxBufferLength: 2 });
      video.addEventListener("error", () => reject(new Error(video.error.message)));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) reject(new Error(data.details));
      });
      let seeked = false;
      video.addEventListener("timeupdate", function seek() {
        if (video.currentTime === 0) return;
        video.removeEventListener("timeupdate", seek);
        video.currentTime = 5;
      });
      video.addEventListener("seeked", () => { seeked = video.currentTime >= 5; });
      video.addEventListener("ended", () => {
        if (seeked) resolve();
        else reject(new Error("Video ended before seeking"));
      }, { once: true });
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(reject));
      hls.loadSource("/master.m3u8");
      hls.attachMedia(video);
    })`, true);
    for (const file of [
      "/master.m3u8", "/hls/master.m3u8", "/media.m3u8", "/init.mp4",
      "/media0.m4s", "/media7.m4s",
    ]) {
      assert.ok(requested.has(file), `Expected a proxied request for ${file}`);
    }
    console.log("Detached HLS played, sought to 5 seconds, and reached the end with captured headers.");
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    for (const server of servers) server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

app.on("window-all-closed", () => {});
const timeout = setTimeout(() => {
  console.error("Detached playback check timed out");
  app.exit(1);
}, 35000);

app.whenReady().then(checkPlayback).then(
  () => {
    clearTimeout(timeout);
    app.exit(0);
  },
  (error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  },
);
