import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSkipSegment, fetchSkipSegments } from "./skipSegments.js";

test("episode skip lookup uses the playback duration and preserves post-credit scenes", async (context) => {
  const request = context.mock.method(globalThis, "fetch", async () => Response.json({
    type: "tv", season: 27, episode: 5, group_duration_ms: 1321000,
    intro: [{ start_ms: null, end_ms: 43975 }],
    credits: [{ start_ms: 1240000, end_ms: 1270000 }, { start_ms: 1316076, end_ms: null }],
  }));
  const segments = await fetchSkipSegments({
    tmdbId: 2190, mediaType: "tv", season: 27, episode: 5, duration: 1320,
  });

  const url = new URL(request.mock.calls[0].arguments[0]);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    tmdb_id: "2190", duration_ms: "1320000", details: "true", merge_unknown: "false",
    season: "27", episode: "5",
  });
  assert.deepEqual(activeSkipSegment(segments, 0, 1320), { kind: "intro", endTime: 43.975 });
  assert.deepEqual(activeSkipSegment(segments, 1250, 1320), { kind: "outro", endTime: 1270 });
  assert.equal(activeSkipSegment(segments, 1271, 1320), undefined);
  assert.deepEqual(activeSkipSegment(segments, 1317, 1320.2, { automatic: true }), { kind: "outro", endTime: 1320.2 });
});

test("out-of-range or invalid markers cannot cause a seek", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    type: "movie",
    intro: [{ start_ms: -1000, end_ms: 10000 }, { start_ms: 5000, end_ms: 1000 }],
    credits: [{ start_ms: 90000, end_ms: 130000 }, { start_ms: null, end_ms: null }],
  }));
  assert.deepEqual(await fetchSkipSegments({ tmdbId: 550, mediaType: "movie", duration: 100 }), []);
  assert.equal(activeSkipSegment([{ kind: "outro", startTime: 90, endTime: 100 }], 92, 95), undefined);
});

test("AniSkip uses the resolved episode number and TheIntroDB fills missing segments", async (context) => {
  const request = context.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("api.aniskip.com")) return Response.json({
      found: true, results: [{ skipType: "op", interval: { startTime: 12, endTime: 93 }, episodeLength: 1441 }],
    });
    return Response.json({ type: "tv", season: 2, episode: 13, group_duration_ms: 1440000,
      intro: [{ start_ms: 0, end_ms: 95000 }], credits: [{ start_ms: 1300000, end_ms: null }] });
  });
  const segments = await fetchSkipSegments({
    tmdbId: 123, mediaType: "tv", season: 2, episode: 13, malId: 789, animeEpisode: 1, duration: 1440,
  });
  assert.match(request.mock.calls[0].arguments[0], /skip-times\/789\/1\?.*episodeLength=1440/);
  assert.deepEqual(segments, [
    { kind: "intro", startTime: 12, endTime: 93, sourceDuration: 1441 },
    { kind: "outro", startTime: 1300, endTime: null, sourceDuration: 1440 },
  ]);
});

test("markers from a different cut cannot skip the remainder of an extended episode", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    type: "tv", season: 27, episode: 5, group_duration_ms: 1345000,
    credits: [{ start_ms: 1316076, end_ms: null }],
  }));
  const media = { tmdbId: 2190, mediaType: "tv", season: 27, episode: 5 };
  assert.deepEqual(await fetchSkipSegments({ ...media, duration: 1800 }), []);
  const segments = await fetchSkipSegments({ ...media, duration: 1345 });
  assert.equal(activeSkipSegment(segments, 1317, 1800, { automatic: true }), undefined);
});

test("a timestamp with an unknown cut can only be used manually", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    type: "movie", intro: [{ start_ms: 2000, end_ms: 10000 }],
  }));
  const segments = await fetchSkipSegments({ tmdbId: 550, mediaType: "movie", duration: 100 });
  assert.deepEqual(activeSkipSegment(segments, 5, 100), { kind: "intro", endTime: 10 });
  assert.equal(activeSkipSegment(segments, 5, 100, { automatic: true }), undefined);
});

test("a stalled AniSkip lookup times out and the fallback still runs", async (context) => {
  const nativeSetTimeout = setTimeout;
  context.mock.method(globalThis, "setTimeout", (abort, duration) => {
    assert.equal(duration, 2500);
    return nativeSetTimeout(abort, 5);
  });
  const request = context.mock.method(globalThis, "fetch", async (url, { signal }) => {
    if (url.includes("api.aniskip.com")) {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    return Response.json({ type: "movie", group_duration_ms: 100000,
      intro: [{ start_ms: 2000, end_ms: 10000 }] });
  });
  const controller = new AbortController();
  const segments = await fetchSkipSegments({
    tmdbId: 550, mediaType: "movie", malId: 1, animeEpisode: 1, duration: 100, signal: controller.signal,
  });
  assert.deepEqual(activeSkipSegment(segments, 5, 100, { automatic: true }), { kind: "intro", endTime: 10 });
  assert.equal(request.mock.callCount(), 2);
  assert.equal(controller.signal.aborted, false);
});

test("cancelling playback cancels AniSkip without starting TheIntroDB", async (context) => {
  const request = context.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const lookup = fetchSkipSegments({
    tmdbId: 550, mediaType: "movie", malId: 1, animeEpisode: 1, duration: 100, signal: controller.signal,
  });
  controller.abort();
  assert.deepEqual(await lookup, []);
  assert.equal(request.mock.callCount(), 1);
});
