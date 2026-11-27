const newSourcesTestedAt = Date.UTC(2026, 10, 27);
const builtIns = [
  {
    id: "vidsrc", label: "VidSrc", progress: "frames", interceptFullscreen: true,
    langParam: "ds_lang", params: { autoplay: "1" },
    movieUrl: "https://vsembed.su/embed/movie/{id}",
    tvUrl: "https://vsembed.su/embed/tv/{id}/{season}/{episode}",
  },
  {
    id: "vidfast", label: "Vidfast", cleanUserAgent: true, colorParam: "theme", langParam: "sub",
    params: { autoPlay: "true", poster: "true", title: "true", pip: "hide" },
    movieUrl: "https://vidfast.vc/movie/{id}",
    tvUrl: "https://vidfast.vc/tv/{id}/{season}/{episode}",
    web: { movie: "works", tv: "works" },
  },
  {
    id: "vidlove", label: "Vidlove", colorParam: "primarycolor",
    params: { autoplay: "true", autonext: "false", tour: "true", showNextEpisode: "false", hideautonext: "true", hidenextbutton: "true" },
    movieUrl: "https://player.vidlove.cc/embed/movie/{id}",
    tvUrl: "https://player.vidlove.cc/embed/tv/{id}/{season}/{episode}",
  },
  {
    id: "aether", label: "Aether", note: "Multi Lang",
    movieUrl: "https://aether.ist/media/tmdb-movie-{id}",
    tvUrl: "https://aether.ist/media/tmdb-tv-{id}/{season}/{episode}",
    web: { movie: "works", tv: "works" },
    hideCss: [
      "div:has(> .top-content)", ".top-content",
      '[id="__overlayRouter::episodes"]', '[id="__overlayRouter::episodes"] + button',
      'a.tabbable[class*="cancelHover"]',
      'button.tabbable.p-2.rounded-full:has(> span.text-xl > svg[width="18"][height="18"])',
    ],
  },
  {
    id: "vidrift", label: "Vidrift", note: "Multi Lang, Anime ✓",
    colorParam: "brandColor", langParam: "sub", params: { title: "true", hide: "next,episodes,cast" },
    movieUrl: "https://embed.vidrift.net/embed/movie/{id}",
    tvUrl: "https://embed.vidrift.net/embed/tv/{id}/{season}/{episode}",
  },
  {
    id: "vidnest", label: "Vidnest", note: "Anime ✓",
    movieUrl: "https://vidnest.fun/movie/{id}",
    tvUrl: "https://vidnest.fun/tv/{id}/{season}/{episode}",
    animeUrl: "https://vidnest.fun/anime/{anilist}/{episode}/{lang}",
    web: { movie: "failed", tv: "works" },
    hideCss: [".popup-selector", "#overlay-id"],
  },
  {
    id: "devideosrc", label: "DeVideoSrc", note: "🇩🇪", idType: "imdb",
    progress: "frames", skipResetGuard: true, interceptFullscreen: true,
    colorParam: "color", colorWithHash: true, params: { autoplay: "1", muted: "0" },
    movieUrl: "https://devideosrc.co/custom/movie/{id}",
    tvUrl: "https://devideosrc.co/custom/serial/{id}/{season}/{episode}",
  },
  {
    id: "frembed", label: "Frembed", note: "🇫🇷",
    progress: "frames", skipResetGuard: true, interceptFullscreen: true,
    movieUrl: "https://frembed.uno/embed/movie/{id}",
    tvUrl: "https://frembed.uno/embed/serie/{id}?sa={season}&epi={episode}",
    hideCss: [".popup-selector"],
  },
  {
    id: "kinohub", label: "KinoHub", note: "🇷🇺", idType: "kinopoisk",
    progress: "frames", interceptFullscreen: true, onlyElement: "section.player_section",
    movieUrl: "https://on.kinohub.vip/movie/{id}",
  },
  {
    id: "vidy", label: "Vidy", params: { autoplay: "true" },
    movieUrl: "https://www.vidy.st/movie/{id}",
    tvUrl: "https://www.vidy.st/tv/{id}/{season}/{episode}",
    web: { movie: "works", tv: "works", testedAt: newSourcesTestedAt },
  },
  {
    id: "embedwave", label: "Embedwave",
    movieUrl: "https://embedwave.cc/embed/movie/{id}",
    tvUrl: "https://embedwave.cc/embed/tv/{id}/{season}/{episode}",
    web: { movie: "works", tv: "works", testedAt: newSourcesTestedAt },
  },
  {
    id: "viduki", label: "Viduki",
    movieUrl: "https://www.viduki.net/1/movie/{id}",
    tvUrl: "https://www.viduki.net/1/tv/{id}/{season}/{episode}",
    web: { movie: "works", tv: "works", testedAt: newSourcesTestedAt },
  },
  {
    id: "moviesapi", label: "MoviesAPI",
    movieUrl: "https://moviesapi.to/movie/{id}",
    tvUrl: "https://moviesapi.to/tv/{id}/{season}/{episode}",
    web: { movie: "works", testedAt: newSourcesTestedAt },
  },
  { id: "hianime", label: "HiAnime", tag: "ANIME", resolver: "hianime" },
];

export const TEST_TITLES = {
  movie: { tmdb: "550", imdb: "tt0137523", kinopoisk: "361" },
  tv: { tmdb: "1396", imdb: "tt0903747", season: "1", episode: "1" },
  anime: { anilist: "1", episode: "1", lang: "sub", title: "Cowboy Bebop" },
};

const placeholders = {
  movie: ["id"],
  tv: ["id", "season", "episode"],
  anime: ["anilist", "episode", "lang"],
};
const kinds = Object.keys(placeholders);
const statuses = ["works", "failed", "untested"];
export const validSubtitleLanguage = (value) => typeof value === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(value);
const placeholderPattern = /\{([^{}]*)\}/g;
const paramName = /^[A-Za-z0-9_.-]{1,40}$/;
const record = (value) => value && typeof value === "object" && !Array.isArray(value);

function parseTemplate(value, kind) {
  if (typeof value !== "string" || value.length > 2048 || !/^https:\/\//i.test(value) || /[\\\s]/.test(value)) return null;
  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  if (!authority || /[{}]/.test(authority)) return null;
  if ([...value.matchAll(placeholderPattern)].some(([, name]) => !placeholders[kind].includes(name))) return null;
  const filled = value.replace(placeholderPattern, "1");
  if (/[{}]/.test(filled)) return null;
  try {
    const url = new URL(filled);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

export function validateSource(entry) {
  if (!record(entry)) return { ok: false, errors: [{ field: "label", message: "invalidEntry" }] };
  const errors = [];
  const error = (field, message) => errors.push({ field, message });
  const { id } = entry;
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) error("id", "invalidId");
  if (!label || label.length > 40) error("label", "invalidLabel");

  const source = { id, label };
  for (const [field, fallback, allowed] of [
    ["resolver", null, [null, "hianime"]],
    ["idType", "tmdb", ["tmdb", "imdb", "kinopoisk"]],
    ["progress", "page", ["none", "page", "frames"]],
  ]) {
    source[field] = Object.hasOwn(entry, field) ? entry[field] : fallback;
    if (!allowed.includes(source[field])) error(field, "invalidOption");
  }
  for (const field of ["enabled", "cleanUserAgent", "colorWithHash", "skipResetGuard", "interceptFullscreen"]) {
    source[field] = Object.hasOwn(entry, field) ? entry[field] : field === "enabled";
    if (typeof source[field] !== "boolean") error(field, "invalidOption");
  }
  for (const field of ["clickFirst", "onlyElement", "colorParam", "langParam", "note", "tag"]) {
    const value = entry[field] ?? null;
    source[field] = typeof value === "string" ? value.trim() || null : value;
    if (value !== null && (typeof value !== "string" || value.length > 200)) error(field, "invalidText");
  }
  for (const kind of kinds) {
    const field = kind + "Url";
    const value = typeof entry[field] === "string" ? entry[field].trim() || null : entry[field] ?? null;
    source[field] = value;
    if (value !== null && (!parseTemplate(value, kind) || source.resolver)) error(field, "invalidUrl");
  }
  if (!source.resolver && !kinds.some((kind) => source[kind + "Url"])) error("movieUrl", "missingUrl");

  source.params = entry.params === undefined ? {} : entry.params;
  if (!record(source.params) || Object.entries(source.params).some(([key, value]) =>
    !paramName.test(key) || typeof value !== "string" || value.length > 200)) error("params", "invalidParams");

  source.hideCss = entry.hideCss == null ? [] : entry.hideCss;
  if (!Array.isArray(source.hideCss) || source.hideCss.some((value) =>
    typeof value !== "string" || value.length > 200)) error("hideCss", "invalidSelectors");

  const web = entry.web === undefined ? {} : entry.web;
  source.web = { testedAt: Number.isFinite(web?.testedAt) ? web.testedAt : null, reasons: {} };
  if (!record(web)) error("web", "invalidOption");
  for (const kind of kinds) {
    const status = web?.[kind] ?? "untested";
    if (!statuses.includes(status)) error("web", "invalidOption");
    source.web[kind] = status;
    const reason = record(web?.reasons) ? web.reasons[kind] : null;
    if (status === "failed" && typeof reason === "string" && reason.length <= 100) {
      source.web.reasons[kind] = reason;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, source };
}

export const DEFAULT_SOURCES = builtIns.map((entry) => validateSource(entry).source);

export function loadSources(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SOURCES;
  const seen = new Set();
  const sources = [];
  for (const entry of raw) {
    const result = validateSource(entry);
    if (!result.ok || seen.has(result.source.id)) {
      console.warn("Ignoring invalid or duplicate player source", entry?.id);
      continue;
    }
    seen.add(result.source.id);
    sources.push(result.source);
  }
  return sources.length ? sources : DEFAULT_SOURCES;
}

function validValue(name, value, idType) {
  if (name === "lang") return value === "sub" || value === "dub";
  if (typeof value !== "string" && !Number.isSafeInteger(value)) return false;
  return (name === "id" && idType === "imdb" ? /^tt\d+$/ : /^\d+$/).test(String(value));
}

export function buildSourceUrl(source, { kind, extraParams, ...values }) {
  if (!kinds.includes(kind)) return null;
  const template = source?.[kind + "Url"];
  if (!template || !parseTemplate(template, kind)) return null;
  if ([...template.matchAll(placeholderPattern)].some(([, name]) => !validValue(name, values[name], source.idType))) return null;
  const url = new URL(template.replace(placeholderPattern, (_, name) => encodeURIComponent(String(values[name]))));
  for (const params of [source.params, extraParams]) {
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value != null) url.searchParams.set(key, value);
    }
  }
  return url.href;
}

export function newDefaultSources(saved) {
  return DEFAULT_SOURCES.filter(({ id }) => !saved.some((source) => source.id === id));
}

export function loadingFieldsEqual(a, b, kind) {
  const fields = ["resolver", "idType", "cleanUserAgent", "clickFirst", "langParam",
    ...(kind ? [kind] : kinds).map((type) => type + "Url")];
  if (fields.some((field) => a[field] !== b[field])) return false;
  if (a.params === b.params) return true;
  if (!record(a.params) || !record(b.params)) return false;
  const entries = Object.entries(a.params);
  return entries.length === Object.keys(b.params).length &&
    entries.every(([key, value]) => Object.hasOwn(b.params, key) && b.params[key] === value);
}

export function resetStatusOnEdit(previous, next) {
  if (!previous) return next;
  const web = { ...next.web, reasons: { ...next.web.reasons } };
  for (const kind of kinds) {
    if (loadingFieldsEqual(previous, next, kind)) continue;
    web[kind] = "untested";
    delete web.reasons[kind];
  }
  if (kinds.every((kind) => web[kind] === "untested")) web.testedAt = null;
  return { ...next, web };
}

export function sourceIdFromLabel(label, taken) {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32).replace(/^-|-$/g, "") || "source";
  let id = stem;
  for (let suffix = 2; taken.has(id); suffix++) id = stem + "-" + suffix;
  return id;
}

export function sourcePageCss({ onlyElement, hideCss }) {
  if (onlyElement) return [
    "html, body { overflow: hidden !important; background: #000 !important; }",
    "body * { visibility: hidden !important; }",
    ownSelector(onlyElement, true) + " { visibility: visible !important; }",
    ownSelector(onlyElement) + " { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; margin: 0 !important; z-index: 2147483647 !important; background: #000 !important; overflow: auto !important; }",
  ].join("\n");
  return hideCss?.length ? hideCss.join(",\n") + " { display: none !important; }" : null;
}

function ownSelector(selector, includeChildren = false) {
  const target = ":is(" + selector + ")";
  return includeChildren ? target + ", " + target + " *" : target;
}

export function sourceHosts(source) {
  return [...new Set(kinds.flatMap((kind) => {
    const url = parseTemplate(source[kind + "Url"], kind);
    return url ? [url.hostname] : [];
  }))];
}

export function sourceKinds(source) {
  return source.resolver === "hianime" ? ["anime"] : kinds.filter((kind) => source[kind + "Url"]);
}

export function clickFirstScript(selector) {
  return "(() => { const el = document.querySelector(" + JSON.stringify(selector) + "); if (!el) return false; el.click(); return true; })()";
}
