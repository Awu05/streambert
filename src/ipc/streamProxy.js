const http = require("node:http");
const https = require("node:https");
const { pipeline } = require("node:stream/promises");

const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 8;
const MEDIA_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "last-modified",
  "etag",
];

function rewritePlaylist(text, playlistUrl, proxyUrl) {
  const rewrite = (uri, extension) => proxyUrl(new URL(uri, playlistUrl).href, extension);
  let nextIsPlaylist = false;
  let segmentExtension = ".ts";
  return text
    .split(/\r?\n/)
    .map((line) => {
      const uri = line.trim();
      if (!uri) return line;
      if (uri.startsWith("#")) {
        const tag = uri.split(":", 1)[0];
        if (tag === "#EXT-X-STREAM-INF") nextIsPlaylist = true;
        if (tag === "#EXT-X-MAP") segmentExtension = ".m4s";
        let extension = segmentExtension;
        if (["#EXT-X-MEDIA", "#EXT-X-I-FRAME-STREAM-INF", "#EXT-X-RENDITION-REPORT"].includes(tag)) {
          extension = ".m3u8";
        } else if (tag === "#EXT-X-KEY" || tag === "#EXT-X-SESSION-KEY") extension = ".key";
        else if (tag === "#EXT-X-MAP") extension = ".mp4";
        else if (tag === "#EXT-X-CONTENT-STEERING") extension = ".json";
        return line.replace(
          /URI="([^"]+)"/g,
          (_, value) => `URI="${rewrite(value, extension)}"`,
        );
      }
      const extension = nextIsPlaylist ? ".m3u8" : segmentExtension;
      nextIsPlaylist = false;
      return rewrite(uri, extension);
    })
    .join("\n");
}

function openStream(url, headers, agent, signal, lookup, method) {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(url, { headers, agent, signal, lookup, method, auth: null }, resolve);
    request.on("error", reject);
    request.setTimeout(20000, () =>
      request.destroy(new Error("Stream timed out")),
    );
    request.end();
  });
}

async function readPlaylist(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_PLAYLIST_BYTES) throw new Error("Playlist too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function proxyStream(target, req, res, {
  authorizeUrl,
  proxyUrl,
  getHeaders,
  agents,
  playlist = false,
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  const responseHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  try {
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      let url, lookup;
      try {
        const authorized = await authorizeUrl(target);
        url = authorized.url || authorized;
        lookup = authorized.lookup;
      } catch {
        res.writeHead(403, responseHeaders).end();
        return;
      }

      const headers = {
        ...(await getHeaders(url)),
        Accept: "*/*",
        "Accept-Encoding": "identity",
      };
      if (req.headers.range) headers.Range = req.headers.range;
      const method = req.method === "HEAD" ? "HEAD" : "GET";
      const upstream = await openStream(url, headers, agents?.[url.protocol], controller.signal, lookup, method);
      const status = upstream.statusCode || 502;
      if (status >= 300 && status < 400 && upstream.headers.location) {
        upstream.resume();
        target = new URL(upstream.headers.location, url).href;
        continue;
      }

      const isPlaylist = playlist || /\.m3u8$/i.test(url.pathname) ||
        /mpegurl/i.test(upstream.headers["content-type"] || "");
      if (status === 200 && isPlaylist && method === "GET") {
        const text = await readPlaylist(upstream);
        const body = text.trimStart().startsWith("#EXTM3U")
          ? rewritePlaylist(text, url, proxyUrl)
          : text;
        res.writeHead(200, {
          ...responseHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
        });
        res.end(body);
        return;
      }

      for (const name of MEDIA_HEADERS) {
        if (upstream.headers[name]) responseHeaders[name] = upstream.headers[name];
      }
      res.writeHead(status, responseHeaders);
      await pipeline(upstream, res);
      return;
    }
    throw new Error("Too many stream redirects");
  } catch {
    if (!res.destroyed && !res.headersSent) res.writeHead(502, responseHeaders).end();
  } finally {
    res.off("close", abort);
    controller.abort();
  }
}

module.exports = { proxyStream, rewritePlaylist };
