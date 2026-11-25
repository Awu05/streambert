const http = require("node:http");
const https = require("node:https");
const { randomUUID } = require("node:crypto");
const { json, readJson } = require("./httpServer");
const { authorizePublicUrl } = require("./netGuard");
const { providerRequest } = require("./sourceModes");
const { subtitleToVtt } = require("./fileRoutes");
const { signedStreamPath, streamLink } = require("./streams");

async function fetchSubtitle(value, signal, hops = 0) {
  if (hops > 5) throw new Error("Too many subtitle redirects");
  const { url, lookup } = await authorizePublicUrl(value);
  const client = url.protocol === "https:" ? https : http;
  const response = await new Promise((resolve, reject) => {
    client.get(url, { lookup, signal }, resolve).on("error", reject);
  });
  const status = response.statusCode;
  if (status >= 300 && status < 400 && response.headers.location) {
    response.destroy();
    return fetchSubtitle(new URL(response.headers.location, url), signal, hops + 1);
  }
  if (status !== 200) {
    response.destroy();
    throw new Error("Could not load subtitles");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error("Subtitle file is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!/^\uFEFF?WEBVTT(?:\s|$)|\d\d:\d\d:\d\d[,.]\d{3} -->/m.test(text)) {
    throw new Error("Unsupported subtitle format");
  }
  return subtitleToVtt(text);
}

function createPlayHandler({ resolver, streams, auth, registry, hub, hiAnimeUserAgent }) {
  function respond(res, origin, media) {
    const entry = streams.add(media);
    json(res, 200, {
      streamId: entry.id,
      src: signedStreamPath(entry, auth),
      kind: entry.kind,
      subtitles: (entry.subtitles || []).flatMap(({ url, lang }) => {
        try { return [{ src: signedStreamPath(entry, auth, entry.pathFor(url)), lang }]; } catch { return []; }
      }),
      external: streamLink(origin, entry, auth),
    });
  }

  return async function handlePlay(req, res, { url, origin }) {
    if (req.method === "GET" && url.pathname === "/api/subtitle") {
      const target = url.searchParams.get("u");
      try {
        const text = await fetchSubtitle(target, AbortSignal.timeout(15000));
        res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8" }).end(text);
      } catch {
        json(res, 422, { error: "Could not load subtitles" });
      }
      return true;
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/api/play/")) return false;
    const body = await readJson(req);
    switch (url.pathname) {
      case "/api/play/resolve": {
        const provider = providerRequest(body.sourceId, body.mediaType, body.url);
        if (!provider) {
          json(res, 400, { error: "This source is unavailable for this media type" });
          break;
        }
        const clientId = `${body.clientId || ""}:${randomUUID()}`;
        const onClose = () => {
          if (!res.writableEnded) resolver.cancel(clientId);
        };
        res.once("close", onClose);
        try {
          const media = await resolver.resolve(provider, {
            clientId,
            onQueue: (position) => hub.sendTo(body.clientId, "play-queue", { position, requestId: body.requestId }),
          });
          await authorizePublicUrl(media.url);
          respond(res, origin, media);
        } catch (error) {
          if (!res.destroyed) json(res, 422, { error: error.message });
        } finally {
          res.off("close", onClose);
        }
        break;
      }
      case "/api/play/hianime": {
        const result = await registry.invokeRegistered(
          "resolve-hianime", [body.args], hub.clientFor(body.clientId),
        );
        if (!result?.ok) {
          json(res, 422, { error: result?.error || "Could not resolve HiAnime" });
          break;
        }
        await authorizePublicUrl(result.url);
        respond(res, origin, {
          url: result.url,
          kind: result.isDirectMp4 ? "mp4" : "hls",
          headers: { referer: result.referer || "https://hianime.at/", userAgent: hiAnimeUserAgent },
          subtitles: result.subtitle ? [{ url: result.subtitle, lang: "en" }] : [],
        });
        break;
      }
      case "/api/play/cancel":
        resolver.cancel(body.clientId);
        res.writeHead(204).end();
        break;
      default:
        return false;
    }
    return true;
  };
}

module.exports = { createPlayHandler };
