const { randomUUID } = require("node:crypto");
const { extname } = require("node:path").posix;
const { proxyStream } = require("../ipc/streamProxy");
const { rewriteManifest } = require("./dashManifest");

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
      const bases = new Map();
      const baseKeys = new Map();
      const entry = {
        ...media,
        id,
        expires: now() + STREAM_TTL_SECONDS * 1000,
        resources,
        bases,
        baseFor(value) {
          const url = new URL(value);
          if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
            !url.pathname.endsWith("/") || url.search || url.hash) throw new Error("Invalid DASH base");
          if (!baseKeys.has(url.href)) {
            if (bases.size >= 25000) throw new Error("Too many stream resources");
            const key = `b${bases.size}`;
            baseKeys.set(url.href, key);
            bases.set(key, url.href);
          }
          return baseKeys.get(url.href);
        },
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
          const extension = media.kind === "dash" ? "mpd" : media.kind === "mp4" ? "mp4" : "m3u8";
          return `/s/${id}/index.${extension}`;
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

// A signed stream path: works without the login cookie (external players, iOS).
function signedStreamPath(entry, auth, path = entry.path) {
  if (entry.kind === "dash" && path === entry.path) return signedDashPrefix(entry, auth) + "/index.mpd";
  return `${path}?${auth.signUrl(`/s/${entry.id}`, STREAM_TTL_SECONDS)}`;
}

function signedDashPrefix(entry, auth) {
  const scope = `/s/${entry.id}`;
  const signature = new URLSearchParams(auth.signUrl(scope, STREAM_TTL_SECONDS));
  return `${scope}/t/${signature.get("exp")}.${signature.get("sig")}`;
}

function streamLink(origin, entry, auth) {
  return origin + signedStreamPath(entry, auth);
}

function streamHeaders({ origin, referer, userAgent } = {}) {
  return {
    ...(origin ? { Origin: origin } : {}),
    ...(referer ? { Referer: referer } : {}),
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  };
}

function dashTarget(base, rest, search) {
  if (!base || !rest) return null;
  try {
    const decoded = decodeURIComponent(rest).replace(/%(?:25)*(2e|2f|5c|00|3a)/gi,
      (_, byte) => String.fromCharCode(Number.parseInt(byte, 16)));
    if (/^(?:\/|[a-z][\w+.-]*:)|\/\/|[\\\0]|(?:^|\/)\.{1,2}(?:\/|$)/i.test(decoded.trimStart())) return null;
    const target = new URL(rest + search, base);
    return target.href.startsWith(base) ? target.href : null;
  } catch {
    return null;
  }
}

function createStreamHandler({ streams, auth, authorizeUrl }) {
  return function handleStream(req, res, { url, signedIn }) {
    const rawPath = req.url?.split("?", 1)[0] ?? url.pathname;
    if (!rawPath.startsWith("/s/")) return false;
    const dash = /^\/s\/([a-f0-9]{32})\/t\/(\d+)\.([\w-]+)\/(index\.mpd|b\/(b\d+)\/(.*))$/.exec(rawPath);
    const regular = /^\/s\/([a-f0-9]{32})\/(?:index\.(?:m3u8|mp4)|p\/(\d+\.[a-z0-9]+))$/.exec(url.pathname);
    if ((!dash && !regular) || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404).end();
      return true;
    }
    const id = (dash || regular)[1];
    const exp = dash ? dash[2] : url.searchParams.get("exp");
    const sig = dash ? dash[3] : url.searchParams.get("sig");
    const signed = auth.verifyUrl(`/s/${id}`, exp, sig);
    if (!signedIn && !signed) {
      res.writeHead(403).end();
      return true;
    }
    const entry = streams.get(id);
    const manifest = dash?.[4] === "index.mpd";
    const resource = regular?.[2];
    const target = dash
      ? entry?.kind === "dash" && (manifest ? entry.url : dashTarget(entry.bases.get(dash[5]), dash[6], url.search))
      : resource ? entry?.resources.get(resource) : entry?.path === url.pathname ? entry.url : null;
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
      ...(manifest && {
        manifest: (body, finalUrl) => {
          const prefix = signed ? `/s/${id}/t/${exp}.${sig}` : signedDashPrefix(entry, auth);
          return rewriteManifest(body, finalUrl, (folder) => `${prefix}/b/${entry.baseFor(folder)}/`);
        },
      }),
      getHeaders: () => streamHeaders(entry.headers),
    }).then(() => true);
  };
}

module.exports = { createStreamRegistry, createStreamHandler, signedStreamPath, signedDashPrefix, streamLink, streamHeaders };
