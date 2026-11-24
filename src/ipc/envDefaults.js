// Env-driven defaults (desktop leaves them unset).
//   STREAMBERT_TV_MODE=1 -> TV remote mode on unless the user turned it off

function parseEnvDefaults(env) {
  return {
    tvRemoteMode: env.STREAMBERT_TV_MODE === "1",
  };
}

module.exports = { parseEnvDefaults };
