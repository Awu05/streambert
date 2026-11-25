const { randomUUID } = require("node:crypto");
const { extname } = require("node:path").posix;
const { proxyStream } = require("../ipc/streamProxy");

const STREAM_TTL_SECONDS = 6 * 3600;
const MEDIA_EXTENSIONS = new Set([
  ".m3u8", ".ts", ".mp4", ".m4s", ".m4a", ".m4v", ".mp3", ".aac", ".ac3",
  ".eac3", ".vtt", ".webvtt", ".srt", ".webm", ".mkv", ".mov",
]);

function createStreamRegistry({ now = Date.now } = {}) {
  const streams = new Map();
  return {
    add(media) {
      const id = randomUUID().replaceAll("-", "");
      const resources = new Map();
      const urls = new Map();
      const entry = {
        ...media,
        id,
        expires: now() + STREAM_TTL_SECONDS * 1000,
        resources,
        pathFor(value, fallback = ".vtt") {
          const url = new URL(value);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
            throw new Error("Invalid stream resource");
          }
          const extension = extname(url.pathname).toLowerCase();
          const typed = fallback === ".m3u8" || fallback === ".key" || fallback === ".json";
          const suffix = !typed && MEDIA_EXTENSIONS.has(extension) ? extension : fallback;
          const resource = `${url.href}\n${suffix}`;
          let key = urls.get(resource);
          if (key === undefined) {
            if (urls.size >= 25000) throw new Error("Too many stream resources");
            key = `${urls.size}${suffix}`;
            urls.set(resource, key);
            resources.set(key, url.href);
          }
          return `/s/${id}/p/${key}`;
        },
        get path() {
          return `/s/${id}/index.${media.kind === "mp4" ? "mp4" : "m3u8"}`;
        },
      };
      streams.set(id, entry);
      return entry;
    },
    get(id) {
      const entry = streams.get(id);
      if (!entry) return null;
      if (entry.expires <= now()) {
        streams.delete(id);
        return null;
      }
      return entry;
    },
    sweep() {
      for (const [id, entry] of streams) if (entry.expires <= now()) streams.delete(id);
    },
  };
}

// A stream path signed for STREAM_TTL_SECONDS. It works without the login
// cookie, which iOS's native HLS player doesn't always send.
function signedStreamPath(entry, auth, path = entry.path) {
  return `${path}?${auth.signUrl(`/s/${entry.id}`, STREAM_TTL_SECONDS)}`;
}

function streamLink(origin, entry, auth) {
  return origin + signedStreamPath(entry, auth);
}

function createStreamHandler({ streams, auth, authorizeUrl }) {
  return function handleStream(req, res, { url, signedIn }) {
    if (!url.pathname.startsWith("/s/")) return false;
    const match = /^\/s\/([a-f0-9]{32})\/(?:index\.(?:m3u8|mp4)|p\/(\d+\.[a-z0-9]+))$/.exec(url.pathname);
    if (!match || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404).end();
      return true;
    }
    const [, id, resource] = match;
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    const signed = auth.verifyUrl(`/s/${id}`, exp, sig);
    if (!signedIn && !signed) {
      res.writeHead(403).end();
      return true;
    }
    const entry = streams.get(id);
    const target = resource === undefined
      ? (entry?.path === url.pathname ? entry.url : null)
      : entry?.resources.get(resource);
    if (!target) {
      res.writeHead(404).end();
      return true;
    }
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    const proxyUrl = (source, extension) => entry.pathFor(source, extension) + (signed ? `?exp=${exp}&sig=${sig}` : "");
    return proxyStream(target, req, res, {
      authorizeUrl,
      proxyUrl,
      playlist: url.pathname.endsWith(".m3u8"),
      getHeaders: () => {
        const { origin, referer, userAgent } = entry.headers;
        return {
          ...(origin ? { Origin: origin } : {}),
          ...(referer ? { Referer: referer } : {}),
          ...(userAgent ? { "User-Agent": userAgent } : {}),
        };
      },
    }).then(() => true);
  };
}

module.exports = { createStreamRegistry, createStreamHandler, signedStreamPath, streamLink };
