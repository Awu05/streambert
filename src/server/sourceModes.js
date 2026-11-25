const providers = {
  vidfast: {
    host: "vidfast.vc",
    movie: /^\/movie\/\d+$/,
    tv: /^\/tv\/\d+\/\d+\/\d+$/,
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

const SOURCE_MODES = {
  vidfast: { movie: "detached", tv: "detached" },
  aether: { movie: "detached", tv: "detached" },
  vidnest: { tv: "detached" },
  hianime: { anime: "detached" },
};

function providerRequest(sourceId, mediaType, value) {
  if (!Object.hasOwn(providers, sourceId) || !["movie", "tv"].includes(mediaType) ||
    typeof value !== "string" || value.length > 2048) return null;
  const source = providers[sourceId];
  try {
    const url = new URL(value);
    if (url.origin !== `https://${source.host}` || url.username || url.password ||
      !source[mediaType]?.test(url.pathname)) return null;
    url.hash = "";
    url.search = "";
    if (source.cleanUa) {
      url.search = "?autoPlay=true&poster=true&title=true&pip=hide";
    }
    return { url: url.href, cleanUa: source.cleanUa === true };
  } catch {
    return null;
  }
}

module.exports = { SOURCE_MODES, providerRequest };
