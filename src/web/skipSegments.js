import { fetchAniSkipTimings } from "../utils/aniSkip.js";

const INTRO_DB = "https://api.theintrodb.org/v4/media";
const ANISKIP_TIMEOUT_MS = 2500;
const DURATION_TOLERANCE = 5;

function matchesCut(sourceDuration, duration) {
  return Math.abs(sourceDuration - duration) <= DURATION_TOLERANCE;
}

function normalizeSegments(segments, duration) {
  return segments.filter(({ startTime, endTime, sourceDuration }) => {
    const end = endTime === null ? duration : endTime;
    return Number.isFinite(startTime) && startTime >= 0 && Number.isFinite(end)
      && end > startTime && end <= duration + 1
      && (!sourceDuration || matchesCut(sourceDuration, duration));
  });
}

export async function fetchSkipSegments({ tmdbId, mediaType, season, episode, malId, animeEpisode, duration, signal }) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  let anime;
  if (malId && animeEpisode && !signal?.aborted) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, ANISKIP_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      anime = await fetchAniSkipTimings(malId, animeEpisode, { duration, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  const segments = normalizeSegments(Object.entries(anime || {}).map(([kind, { startTime, endTime, episodeLength }]) => ({
    kind, startTime, endTime, sourceDuration: positiveDuration(episodeLength),
  })), duration);
  if (signal?.aborted || !Number.isSafeInteger(Number(tmdbId)) || Number(tmdbId) <= 0) return segments;

  const query = new URLSearchParams({
    tmdb_id: tmdbId, duration_ms: Math.round(duration * 1000), details: "true", merge_unknown: "false",
  });
  if (mediaType === "tv") {
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) return segments;
    query.set("season", season);
    query.set("episode", episode);
  } else if (mediaType !== "movie") {
    return segments;
  }
  if (segments.some(({ kind }) => kind === "intro") && segments.some(({ kind }) => kind === "outro")) return segments;

  try {
    const response = await fetch(`${INTRO_DB}?${query}`, { signal });
    if (!response.ok) return segments;
    const data = await response.json();
    if (data?.type !== mediaType || (mediaType === "tv" && (data.season !== season || data.episode !== episode))) return segments;
    const sourceDuration = positiveDuration(seconds(data.group_duration_ms));
    for (const [kind, ranges] of [["intro", data.intro], ["outro", data.credits]]) {
      if (!Array.isArray(ranges) || segments.some((segment) => segment.kind === kind)) continue;
      segments.push(...normalizeSegments(ranges.map((range) => ({
        kind,
        startTime: range?.start_ms === null && kind === "intro" ? 0 : seconds(range?.start_ms),
        endTime: range?.end_ms === null && kind === "outro" ? null : seconds(range?.end_ms),
        sourceDuration,
      })), duration));
    }
  } catch {}
  return segments;
}

function seconds(milliseconds) {
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : NaN;
}

function positiveDuration(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function activeSkipSegment(segments, time, duration, { automatic = false } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  for (const segment of segments) {
    if (segment.sourceDuration ? !matchesCut(segment.sourceDuration, duration) : automatic) continue;
    const end = segment.endTime === null ? duration : segment.endTime;
    const endTime = Math.min(end, duration);
    if (end <= duration + 1 && time >= segment.startTime && time < endTime - 0.1) {
      return { kind: segment.kind, endTime };
    }
  }
}
