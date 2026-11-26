// Provider pages that can be resolved in a hidden window, with the URL shapes
// accepted for each media type. Only combinations verified to replay outside
// their page are listed.
const providers = {
  vidfast: {
    host: "vidfast.vc",
    movie: /^\/movie\/\d+$/,
    tv: /^\/tv\/\d+\/\d+\/\d+$/,
    query: "?autoPlay=true&poster=true&title=true&pip=hide",
    cleanUa: true,
  },
  aether: {
    host: "aether.ist",
    movie: /^\/media\/tmdb-movie-\d+$/,
    tv: /^\/media\/tmdb-tv-\d+\/\d+\/\d+$/,
  },
  vidnest: {
    host: "vidnest.fun",
    tv: /^\/tv\/\d+\/\d+\/\d+$/,
  },
};

// Sent to the browser: the media types each source can play there.
const BROWSER_SOURCES = {
  ...Object.fromEntries(Object.entries(providers)
    .map(([id, source]) => [id, ["movie", "tv"].filter((kind) => source[kind])])),
  hianime: ["anime"],
};

// The provider URL to open for a play request, or null if it isn't allowed.
function providerRequest(sourceId, mediaType, value) {
  const source = Object.hasOwn(providers, sourceId) ? providers[sourceId] : null;
  if (!["movie", "tv"].includes(mediaType) || !source?.[mediaType] ||
    typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.origin !== `https://${source.host}` || url.username || url.password ||
      !source[mediaType].test(url.pathname)) return null;
    url.hash = "";
    url.search = source.query || "";
    return { url: url.href, cleanUa: source.cleanUa === true };
  } catch {
    return null;
  }
}

module.exports = { BROWSER_SOURCES, providerRequest };
