const http = require("node:http");
const https = require("node:https");
const { authorizePublicUrl } = require("./netGuard");
const { streamHeaders } = require("./streams");
const { buildSourceUrl, sourceKinds, TEST_TITLES } = require("../shared/sources.js");

async function fetchPublic(value, headers, { range, signal: parent } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const signal = parent ? AbortSignal.any([timeout, parent]) : timeout;
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    const { url, lookup } = await authorizePublicUrl(value);
    const client = url.protocol === "https:" ? https : http;
    const response = await new Promise((resolve, reject) => {
      client.get(url, { lookup, signal, headers: range ? { ...headers, Range: range } : headers }, resolve)
        .on("error", reject);
    });
    const status = response.statusCode;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.destroy();
      value = new URL(response.headers.location, url);
      continue;
    }
    if (range || status < 200 || status >= 300) {
      response.destroy();
      return { status, url: url.href };
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) throw new Error("Playlist is too large");
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { status, url: url.href, text: async () => body };
  }
  throw new Error("Too many redirects");
}

const playable = (status) => status >= 200 && status < 300;
const failed = (reason) => ({ status: "failed", reason });
const works = { status: "works" };
const noStream = () => failed("no stream found");
const refused = (status) => failed("stream refused replay (" + status + ")");

async function replay(media, fetch, signal) {
  const headers = streamHeaders(media.headers);
  const range = "bytes=0-1023";
  if (media.kind === "mp4") {
    const { status } = await fetch(media.url, headers, { range, signal });
    return status === 200 || status === 206 ? works : refused(status);
  }
  let playlist = media.url;
  for (let depth = 0; depth < 5; depth++) {
    const response = await fetch(playlist, headers, { signal });
    if (!playable(response.status)) return refused(response.status);
    const lines = (await response.text()).trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines[0] !== "#EXTM3U") return noStream();
    const firstUri = lines.find((line) => !line.startsWith("#"));
    if (!firstUri) return noStream();
    const base = response.url || playlist;
    if (lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:"))) {
      playlist = new URL(firstUri, base).href;
      continue;
    }
    const tagUri = (tag) => lines.find((line) => line.startsWith(tag) && !/METHOD=NONE/.test(line))
      ?.match(/[:,]URI="([^"]+)"/)?.[1];
    // Encryption key (whole file), init segment and first segment (first KB).
    for (const [uri, options] of [
      [tagUri("#EXT-X-KEY:"), { signal }],
      [tagUri("#EXT-X-MAP:"), { range, signal }],
      [firstUri, { range, signal }],
    ]) {
      if (!uri) continue;
      const { status } = await fetch(new URL(uri, base).href, headers, options);
      if (!playable(status)) return refused(status);
    }
    return works;
  }
  return noStream();
}

function captureFailure(error) {
  if (/verification/i.test(error.message)) return failed("provider requires verification");
  if (/DASH/i.test(error.message)) return failed("found DASH, not supported");
  if (/timed out/i.test(error.message)) return failed("timed out");
  return noStream();
}

function createSourceTester({ resolve, resolveHianime, hiAnimeUserAgent, fetch = fetchPublic }) {
  async function testKind(source, kind, options) {
    const { signal } = options;
    let media;
    try {
      const title = TEST_TITLES[kind];
      if (source.resolver === "hianime") {
        const match = await resolveHianime({
          title: title.title, seasonNumber: 1, episodeNumber: 1, isMovie: false, translationType: title.lang,
        });
        if (!match?.ok) throw new Error(match?.error || "No stream found");
        media = {
          url: match.url, kind: match.isDirectMp4 ? "mp4" : "hls",
          headers: { referer: match.referer || "https://hianime.at/", userAgent: hiAnimeUserAgent },
        };
      } else {
        const subtitleLang = options.subtitleLang;
        const extraParams = source.langParam && subtitleLang ? { [source.langParam]: subtitleLang } : undefined;
        const url = buildSourceUrl(source, { ...title, kind, id: title[source.idType], extraParams });
        if (!url) return failed("no address for this title");
        media = await resolve({ url, cleanUa: source.cleanUserAgent, clickFirst: source.clickFirst }, options);
      }
    } catch (error) {
      signal?.throwIfAborted();
      return captureFailure(error);
    }
    try {
      return await replay(media, fetch, signal);
    } catch {
      signal?.throwIfAborted();
      return refused("network error");
    }
  }

  return {
    async test(source, options = {}) {
      const results = {};
      for (const kind of sourceKinds(source)) {
        options.signal?.throwIfAborted();
        results[kind] = await testKind(source, kind, options);
      }
      return results;
    },
  };
}

module.exports = { createSourceTester };
