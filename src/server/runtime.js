const fs = require("node:fs");
const path = require("node:path");
const { createAuth, loadOrCreateSecret } = require("./auth");
const { createProfileStore } = require("./profileStore");
const { startHttpServer } = require("./httpServer");
const { RpcError, makePathGuard } = require("./ipcRegistry");
const { authorizePublicUrl } = require("./netGuard");
const { loadSources } = require("../shared/sources.js");
const { createSourceTester } = require("./sourceTest");
const { createResolver } = require("./resolver");
const { createStreamRegistry, createStreamHandler, streamLink } = require("./streams");
const { createPlayHandler } = require("./playRoutes");
const { createFileHandler } = require("./fileRoutes");
const { createProfiles, MAIN_ID } = require("./profiles");
const { createProfileHandler } = require("./profileRoutes");
const { HOUSEHOLD_ID, HOUSEHOLD_KEYS, watchedDiff } = require("./profileData");
const { canAccess, downloadKey, ownerOf, sizeOf, stampWatched, visibleDownloads } = require("./downloadAccess");
const { startCleanup } = require("./downloadCleanup");

const WYZIE_ORIGINS = ["https://subs.wyzie.ru", "https://sub.wyzie.io"];
const HOUSEHOLD_CREDENTIALS = new Set(["apikey", "subdlApiKey", "wyzieApiKey"]);

function createServerRuntime({ config, userData, root, hub, openPage, bootstrap, downloads, hiAnimeUserAgent }) {
  const { getDownloads, updateDownload, isActive } = downloads;
  const resolver = createResolver({ maxPages: config.maxHiddenPages, openPage });
  const streams = createStreamRegistry();
  const store = createProfileStore(userData);
  const profiles = createProfiles({ file: path.join(userData, "profiles.json") });
  const isDownloadPath = makePathGuard([config.downloadDir]);
  const downloaderDir = config.allowedDirs[0] || "";
  const loopback = config.host === "0.0.0.0" ? "127.0.0.1" :
    config.host.includes(":") ? (config.host === "::" ? "[::1]" : `[${config.host}]`) : config.host;
  let auth;
  let timer;
  let server;
  let handleFile;
  let stopCleanup;
  hub.onClientRemoved(resolver.cancel);

  function assertDownloadPath(file) {
    if (file && !isDownloadPath(file)) throw new RpcError(403, "Path not allowed");
  }

  const subtitleFiles = (entry) => (entry.subtitlePaths || []).map((sub) => sub.path || sub);
  const isBusy = (entry) => isActive(entry.id) || handleFile?.isBusy(entry.filePath);
  function accessible(entry, profile) {
    if (!canAccess(entry, profile)) throw new RpcError(403, "Not your download");
    return entry;
  }

  function deleteDownload(id, { automatic = false } = {}) {
    const entry = getDownloads().find((item) => item.id === id);
    if (!entry) return { ok: false, error: "Download not found" };
    if (automatic ? isBusy(entry) : handleFile?.isPreparing(entry.filePath)) {
      return { ok: false, error: "Download is in use" };
    }
    for (const file of [entry.filePath, entry.downloadPath, ...subtitleFiles(entry)]) assertDownloadPath(file);
    const result = downloads.deleteDownload(id);
    if (result.ok) {
      hub.broadcast("download-progress", { id, deleted: true }, { to: (profileId) =>
        profileId === MAIN_ID || profileId === ownerOf(entry) && !profiles.get(profileId)?.kids });
    }
    return result;
  }

  function override(channel, args, { profile }) {
    if (channel === "get-downloads") return visibleDownloads(getDownloads(), profile, profiles);
    if (channel === "get-downloads-size") {
      const bytes = getDownloads().filter((entry) => canAccess(entry, profile)).reduce((sum, entry) => sum + sizeOf(entry), 0);
      return { bytes };
    }
    if (channel === "delete-download") {
      return deleteDownload(accessible(getDownloads().find((entry) => entry.id === args[0]?.id), profile).id);
    }
    if (channel !== "delete-all-downloads") return undefined;
    if (profile.kids) throw new RpcError(403, "Kids profiles cannot delete downloads");
    const ids = args[0]?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !["number", "string"].includes(typeof id)))) {
      throw new RpcError(400, "Invalid download IDs");
    }
    const selected = ids && new Set(ids);
    const entries = getDownloads().filter((entry) => canAccess(entry, profile) && (!selected || selected.has(entry.id)));
    let deleted = 0;
    for (const entry of entries) if (deleteDownload(entry.id).ok) deleted++;
    return { ok: true, deleted, errors: entries.length - deleted };
  }

  // Subtitle file ids carry their source; only SubDL paths and Wyzie URLs pass.
  function assertSubtitleSources(selected, anyHttps) {
    if (!Array.isArray(selected)) throw new RpcError(400, "Invalid subtitles");
    for (const sub of selected) {
      const id = sub?.file_id;
      const encoded = typeof id === "string" ? id.split("_").slice(2).join("_") : "";
      let allowed = false;
      try {
        if (id?.startsWith("subdl_")) {
          const source = decodeURIComponent(encoded);
          allowed = source.startsWith("/") && !source.startsWith("//") && !source.includes("\\");
        } else if (id?.startsWith("wyzie_")) {
          const url = new URL(sub.direct_url || decodeURIComponent(encoded));
          allowed = url.protocol === "https:" && !url.username && !url.password &&
            (anyHttps || WYZIE_ORIGINS.includes(url.origin));
        }
      } catch {}
      if (!allowed) throw new RpcError(403, "Subtitle source not allowed");
    }
  }

  // A download always comes from a resolved stream (through the loopback proxy)
  // and goes to the server's download folder.
  function downloadArgs(value) {
    const id = typeof value?.m3u8Url === "string" &&
      /^(?:https?:\/\/[^/]+)?\/s\/([a-f0-9]{32})\/index\.(?:m3u8|mp4)(?:\?|$)/.exec(value.m3u8Url)?.[1];
    const entry = id && streams.get(id);
    if (!entry || !auth || typeof value.name !== "string") {
      throw new RpcError(403, "Choose a resolved stream to download");
    }
    const origin = `http://${loopback}:${config.port}`;
    const link = streamLink(origin, entry, auth);
    const signature = new URL(link).search;
    const selected = new Set((Array.isArray(value.subtitles) ? value.subtitles : [])
      .map((item) => String(item?.url ?? "").split("?")[0]));
    const subtitles = (entry.subtitles || []).flatMap((subtitle) => {
      try {
        const resource = entry.pathFor(subtitle.url);
        return selected.has(resource) ? [{ url: origin + resource + signature, lang: subtitle.lang, name: "subtitles.vtt" }] : [];
      } catch {
        return [];
      }
    });
    return {
      ...value,
      name: value.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+|[. ]+$/g, "").slice(0, 180) || "Streambert video",
      downloadPath: config.downloadDir,
      subtitles,
      m3u8Url: link,
    };
  }

  // Server-side rules for IPC calls from the browser, applied before the handler runs.
  function prepare(channel, args, { profile }) {
    const [value] = args;
    switch (channel) {
      case "check-downloader":
        return [downloaderDir || undefined];
      case "run-download":
        if (profile.kids) throw new RpcError(403, "Kids profiles cannot download");
        return [{
          ...downloadArgs(value),
          profileId: profile.id,
          watchedAt: store.getValue(profile.id, "watched")?.[downloadKey(value)] === true ? Date.now() : null,
        }];
      case "secure-store-set":
        if (!profile.main) throw new RpcError(403, "Only the main profile can change household settings");
        if (!HOUSEHOLD_CREDENTIALS.has(value?.key)) throw new RpcError(403, "Unknown household credential");
        break;
      case "secure-store-get":
        if (!HOUSEHOLD_CREDENTIALS.has(value)) throw new RpcError(403, "Unknown household credential");
        break;
      case "get-subtitle-url":
        assertSubtitleSources([{ file_id: value?.fileId }], true);
        break;
      case "download-subtitles-for-file":
        accessible(getDownloads().find((item) => item.filePath && item.filePath === value?.filePath), profile);
        assertDownloadPath(value?.filePath);
        assertSubtitleSources(value?.selectedSubs, false);
        break;
      case "delete-subtitle-file": {
        const entry = accessible(getDownloads().find((item) => item.id === value?.downloadId), profile);
        if (!subtitleFiles(entry).includes(value?.subtitlePath)) throw new RpcError(403, "Not your subtitle");
        assertDownloadPath(value?.subtitlePath);
        break;
      }
      case "prune-subtitle-paths": {
        const entry = accessible(getDownloads().find((item) => item.id === value?.downloadId), profile);
        for (const file of subtitleFiles(entry)) assertDownloadPath(file);
        break;
      }
      case "scan-directory":
        if (!profile.main) throw new RpcError(403, "Only the main profile can scan downloads");
        assertDownloadPath(value);
        break;
      case "file-exists":
      case "get-video-duration":
        assertDownloadPath(value);
        if (!profile.main) {
          accessible(getDownloads().find((item) => item.filePath === value || subtitleFiles(item).includes(value)), profile);
        }
        break;
    }
    return args;
  }

  return {
    prepare,
    override,
    routeEvent(channel, payload) {
      if (channel !== "download-progress") return undefined;
      const entry = getDownloads().find((item) => item.id === payload?.id);
      return (id) => entry && canAccess(entry, profiles.get(id));
    },
    async start(registry) {
      fs.mkdirSync(config.downloadDir, { recursive: true });
      auth = createAuth({ password: config.password, secret: loadOrCreateSecret(path.join(userData, "server-secret")) });
      if (config.resetMainPin && profiles.resetMainPin()) {
        console.log("Main profile PIN removed (STREAMBERT_RESET_MAIN_PIN)");
      }
      const shared = {};
      const migratedKeys = [];
      for (const key of HOUSEHOLD_KEYS) {
        const legacy = store.getValue(MAIN_ID, key);
        if (legacy === undefined) continue;
        migratedKeys.push(key);
        if (store.getValue(HOUSEHOLD_ID, key) === undefined) shared[key] = legacy;
      }
      if (Object.keys(shared).length) {
        store.apply(HOUSEHOLD_ID, { set: shared });
        await store.flush();
      }
      if (migratedKeys.length) {
        store.apply(MAIN_ID, { remove: migratedKeys });
        await store.flush();
      }
      const handleProfiles = createProfileHandler({
        profiles, auth, store, hub, appVersion: bootstrap().appVersion,
        downloadBytes: (id) => getDownloads().filter((entry) => ownerOf(entry) === id)
          .reduce((sum, entry) => sum + sizeOf(entry), 0),
        beforeDelete(id) {
          const owned = getDownloads().filter((entry) => ownerOf(entry) === id);
          if (owned.some(isBusy)) throw new RpcError(409, "A download is in use");
          for (const entry of owned) {
            const result = deleteDownload(entry.id);
            if (!result.ok) throw new RpcError(409, result.error);
          }
        },
      });
      const migrationFile = path.join(userData, "download-watched-migrated");
      if (!fs.existsSync(migrationFile)) {
        const watched = store.getValue(MAIN_ID, "watched");
        const keys = Object.keys(watched ?? {}).filter((key) => watched[key] === true);
        for (const { id, patch } of stampWatched(getDownloads().filter((entry) => !entry.profileId),
          MAIN_ID, { watched: keys, unwatched: [] }, Date.now())) updateDownload(id, patch);
        fs.writeFileSync(migrationFile, "", { mode: 0o600 });
      }
      const tester = createSourceTester({
        resolve: (input, { clientId }) => resolver.resolve(input, { clientId, fresh: true }),
        resolveHianime: (args) => registry.invokeRegistered("resolve-hianime", [args], { send() {} }),
        hiAnimeUserAgent,
      });
      const handlePlay = createPlayHandler({
        resolver, streams, auth, registry, hub, hiAnimeUserAgent, tester,
        getSources: () => loadSources(store.getValue(HOUSEHOLD_ID, "playerSources")),
      });
      handleFile = createFileHandler({ getDownloads, isPathAllowed: isDownloadPath, auth, getProfile: profiles.get });
      const handleStream = createStreamHandler({ streams, auth, authorizeUrl: authorizePublicUrl });
      server = await startHttpServer({
        port: config.port, host: config.host,
        staticDir: path.join(root, "dist-web"),
        loginHtmlPath: path.join(root, "src/server/login.html"),
        auth, registry, hub, store, profiles, handleProfiles,
        onProfileChange(profile, change, before) {
          for (const { id, patch } of stampWatched(getDownloads(), profile.id, watchedDiff(change, before), Date.now())) {
            updateDownload(id, patch);
          }
        },
        bootstrap: () => ({ ...bootstrap(), downloadDir: config.downloadDir, downloaderDir }),
        // Streams and downloads accept signed links, so they're handled before sign-in.
        handleStream: async (req, res, context) => await handleStream(req, res, context) ||
          await handleFile(req, res, context),
        handleApi: handlePlay,
      });
      stopCleanup = startCleanup({
        getDownloads, deleteDownload: (id) => deleteDownload(id, { automatic: true }), sizeOf, isBusy,
        getSettings: () => ({
          days: store.getValue(HOUSEHOLD_ID, "downloadCleanupDays") ?? 7,
          limitGb: store.getValue(HOUSEHOLD_ID, "downloadSpaceLimitGb") ?? 0,
        }),
      });
      timer = setInterval(() => {
        streams.sweep();
        resolver.sweep();
        handleFile.sweep();
      }, 60000);
      timer.unref();
      return server;
    },
    async close() {
      stopCleanup?.();
      clearInterval(timer);
      resolver.close();
      hub.close();
      server?.close();
      server?.closeAllConnections();
      await store.flush();
    },
  };
}

module.exports = { createServerRuntime };
