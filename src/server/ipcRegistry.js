const fs = require("node:fs");
const path = require("node:path");

class RpcError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const RPC_ALLOWLIST = new Set([
  "check-downloader", "run-download", "get-downloads", "delete-download",
  "file-exists", "scan-directory", "get-app-version", "get-block-stats",
  "get-cache-size", "get-downloads-size", "delete-all-downloads",
  "search-subtitles", "get-subtitle-url", "download-subtitles-for-file",
  "delete-subtitle-file", "prune-subtitle-paths", "wyzie-validate-key",
  "secure-store-get", "secure-store-set", "get-video-duration",
]);

const PATH_ARGS = {
  "check-downloader": ([value]) => [value],
  "file-exists": ([value]) => [value],
  "scan-directory": ([value]) => [value],
  "get-video-duration": ([value]) => [value],
  "delete-download": ([value]) => [value?.filePath],
  "download-subtitles-for-file": ([value]) => [value?.filePath],
  "delete-subtitle-file": ([value]) => [value?.subtitlePath],
  "run-download": ([value]) => [value?.downloadPath],
};

function canonicalPath(value) {
  const resolved = path.resolve(value);
  const tail = [];
  let cursor = resolved;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cursor), ...tail);
    } catch (error) {
      const parent = path.dirname(cursor);
      if (error.code !== "ENOENT" || parent === cursor) throw error;
      if (fs.lstatSync(cursor, { throwIfNoEntry: false })) {
        throw error;
      }
      tail.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

const isInside = (file, root) => file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

// True when a path is inside one of the roots, following symlinks. Paths that
// aren't under a root as written are rejected before the file system is read.
function makePathGuard(roots) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return (value) => {
    if (typeof value !== "string" || !value || value.includes("\0")) return false;
    if (process.platform === "win32" && path.parse(value).root.startsWith("\\")) return false;
    try {
      const resolved = normalize(path.resolve(value));
      const rootForms = roots.map((root) => [normalize(path.resolve(root)), normalize(canonicalPath(root))]);
      if (!rootForms.some((forms) => forms.some((root) => isInside(resolved, root)))) return false;
      const full = normalize(canonicalPath(resolved));
      return rootForms.some(([, canonical]) => isInside(full, canonical));
    } catch {
      return false;
    }
  };
}

function captureIpc(ipcMain, { isPathAllowed, prepare = (_channel, args) => args, override }) {
  const original = ipcMain.handle.bind(ipcMain);
  const handlers = new Map();
  ipcMain.handle = (channel, handler) => {
    original(channel, handler);
    handlers.set(channel, handler);
  };
  function invokeRegistered(channel, args, client) {
    const handler = handlers.get(channel);
    if (!handler) throw new RpcError(404, "No handler");
    return handler({ sender: { id: -1, isDestroyed: () => false, send: client.send } }, ...args);
  }
  return {
    async invoke(channel, args, client, context) {
      if (!RPC_ALLOWLIST.has(channel)) throw new RpcError(403, "Not allowed");
      if (!Array.isArray(args)) throw new RpcError(400, "Args must be an array");
      for (const value of PATH_ARGS[channel]?.(args) || []) {
        if (value != null && value !== "" && !isPathAllowed(value)) {
          throw new RpcError(403, "Path not allowed");
        }
      }
      const result = override?.(channel, args, context);
      if (result !== undefined) return result;
      return invokeRegistered(channel, await prepare(channel, args, context), client);
    },
    invokeRegistered,
  };
}

module.exports = { RpcError, makePathGuard, captureIpc };
