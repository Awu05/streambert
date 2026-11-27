const http = require("node:http");
const https = require("node:https");
const { randomUUID } = require("node:crypto");
const { json, readJson } = require("./httpServer");
const { authorizePublicUrl } = require("./netGuard");
const { buildSourceUrl, validateSource, validSubtitleLanguage } = require("../shared/sources.js");
const { subtitleToVtt } = require("./fileRoutes");
const { signedStreamPath, streamLink, streamHeaders } = require("./streams");
const { fetchPublic } = require("./sourceTest");
const { inspectManifest } = require("./dashManifest");
const { MAX_PLAYLIST_BYTES } = require("../ipc/streamProxy");

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

function createPlayHandler({ resolver, streams, auth, registry, hub, hiAnimeUserAgent, getSources, tester }) {
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
      ...(media.animeEpisode && { animeEpisode: media.animeEpisode }),
    });
  }

  return async function handlePlay(req, res, { url, origin, profile, currentProfile }) {
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
    const testing = url.pathname === "/api/sources/test";
    if (req.method !== "POST" || !(testing || url.pathname.startsWith("/api/play/"))) return false;
    const body = (await readJson(req)) ?? {};
    if (currentProfile && !currentProfile()) {
      json(res, 409, { error: "Choose a profile", code: "profile" });
      return true;
    }
    const clientId = !profile || hub.clientMatches(body.clientId, profile.id) ? body.clientId : undefined;
    if (testing) {
      if (profile && !profile.main) {
        json(res, 403, { error: "Only the main profile can test sources" });
        return true;
      }
      const result = validateSource(body.entry);
      if (!result.ok) {
        json(res, 400, { error: "Invalid source", errors: result.errors });
        return true;
      }
      const clientId = "source-test:" + randomUUID();
      const controller = new AbortController();
      const onClose = () => {
        if (res.writableEnded) return;
        controller.abort();
        resolver.cancel(clientId);
      };
      res.once("close", onClose);
      try {
        const subtitleLang = validSubtitleLanguage(body.subtitleLang) ? body.subtitleLang : undefined;
        const results = await tester.test(result.source, { clientId, signal: controller.signal, subtitleLang });
        if (!res.destroyed) json(res, 200, results);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        res.off("close", onClose);
      }
      return true;
    }
    const source = getSources().find((entry) => entry.enabled && entry.id === body.sourceId);
    switch (url.pathname) {
      case "/api/play/resolve": {
        const extraParams = source?.langParam && validSubtitleLanguage(body.subtitleLang)
          ? { [source.langParam]: body.subtitleLang } : undefined;
        const pageUrl = source && !source.resolver && buildSourceUrl(source, {
          kind: body.mediaType, id: body.id, season: body.season, episode: body.episode,
          anilist: body.anilist, lang: body.lang, extraParams,
        });
        if (!pageUrl) {
          json(res, 400, { error: "This source is unavailable for this media type" });
          break;
        }
        const jobId = `${clientId || ""}:${randomUUID()}`;
        const controller = new AbortController();
        const onClose = () => {
          if (!res.writableEnded) {
            controller.abort();
            resolver.cancel(jobId);
          }
        };
        res.once("close", onClose);
        try {
          let media = await resolver.resolve({
            url: pageUrl, cleanUa: source.cleanUserAgent, clickFirst: source.clickFirst,
          }, {
            clientId: jobId,
            onQueue: (position) => hub.sendTo(clientId, "play-queue", { position, requestId: body.requestId }),
          });
          if (media.kind === "dash") {
            const response = await fetchPublic(media.url, streamHeaders(media.headers), {
              signal: controller.signal, maxBytes: MAX_PLAYLIST_BYTES,
            });
            if (response.status < 200 || response.status >= 300) throw new Error(`stream refused replay (${response.status})`);
            const result = inspectManifest(await response.text());
            if (!result.ok) throw new Error(result.reason);
            media = { ...media, url: response.url };
          } else {
            await authorizePublicUrl(media.url);
          }
          if (!res.destroyed) respond(res, origin, media);
        } catch (error) {
          if (!res.destroyed) json(res, 422, { error: error.message });
        } finally {
          res.off("close", onClose);
        }
        break;
      }
      case "/api/play/hianime": {
        if (source?.resolver !== "hianime") {
          json(res, 400, { error: "This source is unavailable for this media type" });
          break;
        }
        const result = await registry.invokeRegistered(
          "resolve-hianime", [body.args], hub.clientFor(clientId),
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
          animeEpisode: result.malId ? { malId: result.malId, number: result.episodeNumber } : undefined,
        });
        break;
      }
      default:
        return false;
    }
    return true;
  };
}

module.exports = { createPlayHandler };
