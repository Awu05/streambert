const channels = {
  checkDownloader: "check-downloader", runDownload: "run-download",
  getDownloads: "get-downloads", deleteDownload: "delete-download",
  fileExists: "file-exists", scanDirectory: "scan-directory",
  getAppVersion: "get-app-version", getBlockStats: "get-block-stats",
  getCacheSize: "get-cache-size", getDownloadsSize: "get-downloads-size",
  deleteAllDownloads: "delete-all-downloads", searchSubtitles: "search-subtitles",
  getSubtitleUrl: "get-subtitle-url", downloadSubtitlesForFile: "download-subtitles-for-file",
  deleteSubtitleFile: "delete-subtitle-file", wyzieValidateKey: "wyzie-validate-key",
  getVideoDuration: "get-video-duration",
};
const events = {
  PlayerRemoteBack: ["player-remote-back", false], M3u8Found: ["m3u8-found"],
  SubtitleFound: ["subtitle-found"], DownloadProgress: ["download-progress"],
  ConfirmClose: ["confirm-close"], WebviewEnterFullscreen: ["webview-enter-fullscreen", false],
  WebviewLeaveFullscreen: ["webview-leave-fullscreen", false], BlockedUpdate: ["blocked-stats-update"],
  PipOpened: ["pip-window-opened", false], PipClosed: ["pip-window-closed", false],
  WindowMaximize: ["window-maximized"], UpdateProgress: ["update-progress"],
  ScheduledBackupRequested: ["scheduled-backup-requested", false], PlayQueue: ["play-queue"],
};
const desktopOnly = [
  "showInFolder", "pickFolder", "openPath", "getInstallPath", "openPathAtTime",
  "openStreamExternal", "resolveHiAnime", "setPlayerVideo", "debugHiAnime", "quitApp",
  "clearAppCache", "queryVideoProgress", "clearWatchData", "resetApp", "wyzieOpenRedeem",
  "openPipWindow", "closePipWindow", "getPipWebContentsId", "windowMinimize",
  "windowToggleMaximize", "windowClose", "detectUpdateFormat", "downloadAndInstallUpdate",
  "cancelUpdate", "getScheduledBackupSettings", "setScheduledBackupSettings",
  "performScheduledBackup", "fetchReleaseImage", "discordRpcSetEnabled", "discordRpcUpdateActivity",
];

let clientId = null;
export const getClientId = () => clientId;

export async function apiRequest(path, data, { fetch = globalThis.fetch, window = globalThis.window, signal } = {}) {
  const body = data === undefined ? undefined : JSON.stringify(data);
  const response = await fetch(path, {
    credentials: "same-origin", signal,
    ...(body === undefined ? {} : {
      method: "POST", keepalive: path === "/api/storage" && body.length < 15000,
      headers: { "Content-Type": "application/json" }, body,
    }),
  });
  if (response.status === 401) window.location.assign("/login");
  if (response.status === 204) return undefined;
  let result;
  try { result = await response.json(); } catch { throw new Error("Invalid server response"); }
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

export function installWebBridge(boot, {
  fetch = globalThis.fetch, EventSource = globalThis.EventSource, window = globalThis.window,
  onStorageChanged, onReconnect,
} = {}) {
  clientId = null;
  const source = new EventSource("/api/events");
  const listeners = new Map();
  const subscribe = (channel, handler) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(handler);
    return handler;
  };
  source.onmessage = ({ data }) => {
    const { channel, payload } = JSON.parse(data);
    if (channel === "hello") {
      const reconnect = clientId !== null;
      clientId = payload.clientId;
      if (reconnect) onReconnect?.();
    } else if (channel === "storage-changed") onStorageChanged?.(payload);
    else for (const handler of listeners.get(channel) || []) handler(payload);
  };
  const rpc = async (channel, ...args) =>
    (await apiRequest(`/api/rpc/${channel}`, { args, clientId }, { fetch, window }))?.result;
  const bridge = {
    isWeb: true, browserSources: boot.browserSources || {},
    cleanUserAgent: boot.cleanUserAgent, envDefaults: boot.envDefaults,
    capabilities: {
      desktop: false, pip: false, externalPlayer: false, folderPicker: false,
      updater: false, discord: false, windowControls: false, scheduledBackup: false,
    },
    pruneSubtitlePaths: (downloadId) => rpc("prune-subtitle-paths", { downloadId }),
    secureGet: async (key) => (await rpc("secure-store-get", key))?.value ?? null,
    secureSet: (key, value) => rpc("secure-store-set", { key, value }),
    setTvRemoteMode() {},
    respondClose() {},
    playerStopped() {},
    async openExternal(url) {
      if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
    },
    async showNotification({ title, body, silent }) {
      if (window.Notification?.permission === "granted") new window.Notification(title, { body, silent });
    },
    async windowIsMaximized() { return false; },
    async getPlatform() { return "web"; },
    setZoomFactor(factor) { window.document.documentElement.style.zoom = String(factor); },
    onHiAnimeProgress(callback) {
      const handler = subscribe("hianime-progress", (payload) => callback(payload?.stage));
      return () => listeners.get("hianime-progress")?.delete(handler);
    },
  };
  for (const [key, channel] of Object.entries(channels)) {
    bridge[key] = (...args) => rpc(channel, ...args);
  }
  for (const key of desktopOnly) bridge[key] = async () => null;
  for (const [name, [channel, withPayload = true]] of Object.entries(events)) {
    bridge[`on${name}`] = (callback) =>
      subscribe(channel, (payload) => withPayload ? callback(payload) : callback());
    bridge[`off${name}`] = (handler) => listeners.get(channel)?.delete(handler);
  }
  window.electron = bridge;
}
