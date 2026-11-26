const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { json } = require("./httpServer");
const { canAccess } = require("./downloadAccess");

const TYPES = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska",
  ".webm": "video/webm", ".ts": "video/mp2t", ".mov": "video/quicktime",
};
const LINK_SECONDS = 6 * 3600;
const TS_PACKET = 188;

function subtitleToVtt(source) {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (/^WEBVTT(?:\s|$)/.test(text)) return text;
  return "WEBVTT\n\n" + text
    .replace(/^(\d+)\n(?=\d\d:\d\d:\d\d[,.]\d{3} -->)/gm, "")
    .replace(/^(.* --> .*?)$/gm, (line) => line.replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2"));
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && start <= end ? { start, end } : null;
}

// The downloader can save the joined HLS segments (MPEG-TS) under a .mp4 name.
// Browsers can't play TS as a file, so it's detected by its sync bytes.
async function isMpegTs(file) {
  const handle = await fs.promises.open(file, "r");
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(TS_PACKET * 2 + 1), 0, TS_PACKET * 2 + 1, 0);
    return bytesRead > TS_PACKET * 2 && buffer[0] === 0x47 && buffer[TS_PACKET] === 0x47 && buffer[TS_PACKET * 2] === 0x47;
  } finally {
    await handle.close();
  }
}

// Repackages the streams into a real MP4 without re-encoding, then swaps the
// file in place, so the name and quality stay the same.
function remuxToMp4(file) {
  const temp = `${file}.remux-${process.pid}.mp4`;
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v", "error", "-y", "-i", file, "-map", "0:v?", "-map", "0:a?",
      "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", "-f", "mp4", temp,
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let errors = "";
    child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-500); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errors.trim() || `ffmpeg exited with ${code}`))));
  }).then(
    () => fs.promises.rename(temp, file),
    async (error) => {
      await fs.promises.rm(temp, { force: true });
      throw error;
    },
  );
}

function createFileHandler({
  getDownloads, isPathAllowed, auth, getProfile = () => null,
  convert = remuxToMp4, detect = isMpegTs, now = Date.now,
}) {
  const preparing = new Map();
  const serving = new Map();
  const recentlyPlayed = new Map();
  const scope = (resource, profile) => `${resource}:${profile.id}:${profile.version}`;
  function signed(resource, profile) {
    return `${resource}?profile=${profile.id}&${auth.signUrl(scope(resource, profile), LINK_SECONDS, { profile: true })}`;
  }

  function prepare(file) {
    if (!preparing.has(file)) {
      preparing.set(file, detect(file)
        .then((needsRemux) => needsRemux && convert(file))
        .finally(() => preparing.delete(file)));
    }
    return preparing.get(file);
  }

  async function handleFile(req, res, { url, signedIn, profile, currentProfile }) {
    if (!url.pathname.startsWith("/api/files/")) return false;
    const action = /^\/api\/files\/(prepare|playing)\/([\w-]+)$/.exec(url.pathname);
    if (action) {
      if (!profile) return false;
      if (req.method !== "POST") return res.writeHead(405).end(), true;
      const download = getDownloads().find((item) => String(item.id) === action[2]);
      const file = download?.filePath;
      if (!file || !canAccess(download, profile)) return json(res, 404, { error: "Download not found" }), true;
      if (!isPathAllowed(file)) return json(res, 403, { error: "Path not allowed" }), true;
      if (action[1] === "playing") {
        recentlyPlayed.set(file, now() + 90000);
        return res.writeHead(204).end(), true;
      }
      try {
        await prepare(file);
      } catch (error) {
        console.error("Could not prepare download for the browser:", error.message);
        json(res, 422, { error: "This file could not be prepared for the browser.", detail: error.message.slice(0, 200) });
        return true;
      }
      const active = currentProfile();
      if (!canAccess(download, active)) return json(res, 409, { error: "Choose a profile", code: "profile" }), true;
      recentlyPlayed.set(file, now() + 90000);
      const id = encodeURIComponent(action[2]);
      json(res, 200, {
        src: signed(`/api/files/download/${id}`, active),
        subtitles: (download.subtitlePaths || []).map((_subtitle, index) => signed(`/api/files/subtitle/${id}/${index}`, active)),
      });
      return true;
    }

    const id = /^\/api\/files\/(download)\/([\w-]+)$/.exec(url.pathname) ||
      /^\/api\/files\/(subtitle)\/([\w-]+)\/(\d+)$/.exec(url.pathname);
    if (!id || !["GET", "HEAD"].includes(req.method)) return false;
    const [, kind, downloadId, index] = id;
    const download = getDownloads().find((item) => String(item.id) === downloadId);
    const signer = getProfile(url.searchParams.get("profile"));
    const validLink = !signedIn && signer && canAccess(download, signer) &&
      auth.verifyUrl(scope(url.pathname, signer), url.searchParams.get("exp"), url.searchParams.get("sig"), { profile: true });
    if (!canAccess(download, profile) && !validLink) return false;
    const subtitle = download?.subtitlePaths?.[Number(index)];
    const file = kind === "download" ? download?.filePath : (subtitle?.path || subtitle);
    if (!file) res.writeHead(404).end();
    else if (!isPathAllowed(file)) res.writeHead(403).end();
    else if (kind === "download" && preparing.has(file)) res.writeHead(409).end();
    else {
      if (kind === "download" && req.method === "GET") recentlyPlayed.set(file, now() + 90000);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat?.isFile()) res.writeHead(404).end();
      else if (signedIn && !canAccess(download, currentProfile())) res.writeHead(404).end();
      else if (kind === "subtitle") {
        if (stat.size > 2 * 1024 * 1024) res.writeHead(413).end();
        else res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8" })
          .end(subtitleToVtt(await fs.promises.readFile(file, "utf8")));
      } else {
        const headers = {
          "Accept-Ranges": "bytes",
          "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        };
        const range = req.headers.range && parseRange(req.headers.range, stat.size);
        if (req.headers.range && !range) {
          res.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` }).end();
        } else {
          const start = range?.start ?? 0;
          const end = range?.end ?? stat.size - 1;
          headers["Content-Length"] = range ? end - start + 1 : stat.size;
          if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
          res.writeHead(range ? 206 : 200, headers);
          if (req.method === "HEAD" || stat.size === 0) res.end();
          else {
            serving.set(file, (serving.get(file) ?? 0) + 1);
            try {
              await pipeline(fs.createReadStream(file, { start, end }), res);
            } finally {
              const count = serving.get(file) - 1;
              if (count) serving.set(file, count);
              else serving.delete(file);
            }
          }
        }
      }
    }
    return true;
  }
  handleFile.isPreparing = (file) => preparing.has(file);
  handleFile.isBusy = (file) => {
    if (preparing.has(file) || serving.has(file)) return true;
    return (recentlyPlayed.get(file) ?? 0) > now();
  };
  handleFile.sweep = () => {
    const time = now();
    for (const [file, expires] of recentlyPlayed) if (expires <= time) recentlyPlayed.delete(file);
  };
  return handleFile;
}

module.exports = { createFileHandler, subtitleToVtt };
