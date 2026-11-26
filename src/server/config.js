const path = require("node:path");

function parseServerConfig(env, userDataDir) {
  const enabled = env.STREAMBERT_SERVER === "1";
  const password = enabled ? env.STREAMBERT_PASSWORD || "" : "";
  if (enabled && !password.trim()) {
    throw new Error("STREAMBERT_PASSWORD must be set in server mode");
  }

  const port = enabled ? Number(env.STREAMBERT_PORT) : NaN;
  const maxPages = enabled ? Number(env.STREAMBERT_MAX_HIDDEN_PAGES?.trim() || NaN) : NaN;
  return {
    enabled,
    password,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8080,
    host: (enabled && env.STREAMBERT_HOST?.trim()) || "0.0.0.0",
    maxHiddenPages: Number.isSafeInteger(maxPages) ? Math.max(1, maxPages) : 2,
    downloadDir: enabled && env.STREAMBERT_DOWNLOAD_DIR
      ? path.resolve(env.STREAMBERT_DOWNLOAD_DIR)
      : path.join(userDataDir, "Downloads"),
    allowedDirs: enabled
      ? (env.STREAMBERT_ALLOWED_DIRS || "").split(",").map((entry) => entry.trim()).filter(Boolean)
          .map((entry) => path.resolve(entry))
      : [],
  };
}

module.exports = { parseServerConfig };
