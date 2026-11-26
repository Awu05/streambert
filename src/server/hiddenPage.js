const { setTimeout: delay } = require("node:timers/promises");
const { getStreamRequestMeta } = require("../ipc/streamRequestMeta");
const { authorizePublicUrl, publicUrl } = require("./netGuard");

const { clickFirstScript } = require("../shared/sources.js");

function classifyResponse(path, type) {
  if (/\.m3u8$/i.test(path) || /mpegurl/i.test(type)) return "hls";
  if (/\.mp4$/i.test(path) || /^video\/mp4/i.test(type)) return "mp4";
  if (/\.mpd$/i.test(path) || /dash\+xml/i.test(type)) return "dash";
  if (/\.vtt$/i.test(path) || /text\/vtt/i.test(type)) return "vtt";
  return null;
}

// Short MP4s (ads, background loops) are skipped; a film is far larger.
const MIN_MP4_BYTES = 5 * 1024 * 1024;

// Full file size from Content-Range ("bytes 0-1/12345") or Content-Length.
function responseSize(headers = {}) {
  const header = (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]?.join(",");
  const total = /\/(\d+)\s*$/.exec(header("content-range") || "")?.[1] ?? header("content-length");
  return Number(total) || 0;
}

function createHiddenPageCapture({ BrowserWindow, clickPlayDeep, buildCleanUserAgent, extractSubtitleLang, partition = "persist:player" }) {
  const windows = new Map();
  const requests = new Map();
  const hosts = new Map();

  return {
    async checkRequest(details) {
      try {
        const { url, host } = publicUrl(details.url);
        let known = hosts.get(host);
        if (!known || known.expires <= Date.now()) {
          if (hosts.size >= 512) hosts.delete(hosts.keys().next().value);
          known = { expires: Date.now() + 60000, allowed: authorizePublicUrl(url).then(() => true, () => false) };
          hosts.set(host, known);
        }
        return await known.allowed;
      } catch {
        return false;
      }
    },
    beforeSend(details) {
      const capture = windows.get(details.webContentsId);
      if (!capture) return;
      capture.requests.add(details.id);
      requests.set(details.id, getStreamRequestMeta(details));
    },
    onResponse(details) {
      const capture = windows.get(details.webContentsId);
      const headers = requests.get(details.id);
      requests.delete(details.id);
      capture?.requests.delete(details.id);
      if (!capture || !headers || details.statusCode < 200 || details.statusCode >= 300) return;
      const type = Object.entries(details.responseHeaders || {})
        .find(([name]) => name.toLowerCase() === "content-type")?.[1]?.join(";") || "";
      const kind = classifyResponse(new URL(details.url).pathname, type);
      if (kind === "hls") capture.hls ??= { url: details.url, kind, headers };
      if (kind === "mp4" && responseSize(details.responseHeaders) >= MIN_MP4_BYTES) {
        capture.mp4 ??= { media: { url: details.url, kind, headers }, at: Date.now() };
      }
      if (kind === "dash") capture.dash = true;
      if (kind === "vtt") capture.subtitles.set(details.url, extractSubtitleLang(details.url) || "und");
    },
    onError(details) {
      requests.delete(details.id);
      windows.get(details.webContentsId)?.requests.delete(details.id);
    },
    async openPage({ url, cleanUa, clickFirst }, signal) {
      signal.throwIfAborted();
      const window = new BrowserWindow({
        show: false, width: 1280, height: 720,
        webPreferences: {
          partition, backgroundThrottling: false,
          sandbox: true, contextIsolation: true, autoplayPolicy: "no-user-gesture-required",
        },
      });
      const wc = window.webContents;
      const id = wc.id;
      const capture = { subtitles: new Map(), requests: new Set() };
      windows.set(id, capture);
      wc.setAudioMuted(true);
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      const abort = () => { if (!window.isDestroyed()) window.destroy(); };
      signal.addEventListener("abort", abort, { once: true });
      const navigation = wc.loadURL(url, cleanUa ? { userAgent: buildCleanUserAgent() } : undefined);
      let loadError;
      navigation.catch((error) => { loadError = error; });
      try {
        let nextClickAt = Date.now() + 2500;
        let clicks = 0;
        let clickedFirst = false;
        while (!capture.hls && !(capture.mp4 && Date.now() - capture.mp4.at >= 1500)) {
          if (loadError && loadError.code !== "ERR_ABORTED") throw new Error("Could not load the source");
          if (Date.now() >= nextClickAt && clicks < 4) {
            nextClickAt = Date.now() + 3500;
            clicks++;
            const blocked = await wc.executeJavaScript(
              '/just a moment|verify you are human|access denied/i.test(document.title + " " + document.body?.innerText.slice(0, 300))',
            ).catch(() => false);
            if (blocked) throw new Error("The provider requires verification");
            if (clickFirst && !clickedFirst) {
              clickedFirst = await wc.executeJavaScript(clickFirstScript(clickFirst), true).catch(() => false);
            }
            if (!capture.hls) void clickPlayDeep(wc).catch(() => {});
          }
          await delay(100, undefined, { signal });
        }
        if (capture.hls) await delay(1200, undefined, { signal });
        return {
          ...(capture.hls ?? capture.mp4.media),
          subtitles: [...capture.subtitles].map(([url, lang]) => ({ url, lang })),
        };
      } catch (error) {
        if (signal.aborted && capture.dash && /timed out/i.test(signal.reason?.message)) {
          throw new Error("found DASH, not supported");
        }
        throw signal.aborted ? signal.reason : error;
      } finally {
        signal.removeEventListener("abort", abort);
        windows.delete(id);
        for (const request of capture.requests) requests.delete(request);
        if (!window.isDestroyed()) window.destroy();
      }
    },
  };
}

module.exports = { classifyResponse, createHiddenPageCapture, responseSize };
