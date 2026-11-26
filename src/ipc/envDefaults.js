// Env-driven defaults (set by the Docker image; desktop leaves them unset).
//   STREAMBERT_ZOOM=<0.5-3> -> UI zoom factor
//   STREAMBERT_DRAG_SCROLL=1 -> drag to scroll (touch screens via Selkies)

function parseEnvDefaults(env) {
  const zoom = parseFloat(env.STREAMBERT_ZOOM);
  return {
    zoom: Number.isFinite(zoom) && zoom >= 0.5 && zoom <= 3 ? zoom : 1,
    dragScroll: env.STREAMBERT_DRAG_SCROLL === "1",
  };
}

module.exports = { parseEnvDefaults };
