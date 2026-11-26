const fs = require("node:fs");
const path = require("node:path");
const { createAuth, loadOrCreateSecret } = require("./auth");
const { createProfileStore } = require("./profileStore");
const { startHttpServer } = require("./httpServer");
const { RpcError, makePathGuard } = require("./ipcRegistry");
const { authorizePublicUrl } = require("./netGuard");
const { BROWSER_SOURCES } = require("./browserSources");
const { createResolver } = require("./resolver");
const { createStreamRegistry, createStreamHandler, streamLink } = require("./streams");
const { createPlayHandler } = require("./playRoutes");
const { createFileHandler } = require("./fileRoutes");

const WYZIE_ORIGINS = ["https://subs.wyzie.ru", "https://sub.wyzie.io"];

function createServerRuntime({ config, userData, root, hub, openPage, bootstrap, getDownloads, hiAnimeUserAgent }) {
  const resolver = createResolver({ maxPages: config.maxHiddenPages, openPage });
  const streams = createStreamRegistry();
  const store = createProfileStore(userData);
  const isDownloadPath = makePathGuard([config.downloadDir]);
  const downloaderDir = config.allowedDirs[0] || "";
  const loopback = config.host === "0.0.0.0" ? "127.0.0.1" :
    config.host.includes(":") ? (config.host === "::" ? "[::1]" : `[${config.host}]`) : config.host;
  let auth;
  let timer;
  let server;
  hub.onClientRemoved(resolver.cancel);

  function assertDownloadPath(file) {
    if (file && !isDownloadPath(file)) throw new RpcError(403, "Path not allowed");
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
  function prepare(channel, args) {
    const [value] = args;
    switch (channel) {
      case "check-downloader":
        return [downloaderDir || undefined];
      case "run-download":
        return [downloadArgs(value)];
      case "get-subtitle-url":
        assertSubtitleSources([{ file_id: value?.fileId }], true);
        break;
      case "download-subtitles-for-file":
        assertDownloadPath(value?.filePath);
        assertSubtitleSources(value?.selectedSubs, false);
        break;
      case "delete-subtitle-file":
        assertDownloadPath(value?.subtitlePath);
        break;
      case "delete-download":
      case "delete-all-downloads":
        assertDownloadPath(value?.filePath);
        for (const item of getDownloads()) {
          if (channel === "delete-download" && item.id !== value?.id) continue;
          for (const file of [item.filePath, item.downloadPath, ...(item.subtitlePaths || []).map((sub) => sub.path || sub)]) {
            assertDownloadPath(file);
          }
        }
        break;
    }
    return args;
  }

  return {
    prepare,
    async start(registry) {
      fs.mkdirSync(config.downloadDir, { recursive: true });
      auth = createAuth({ password: config.password, secret: loadOrCreateSecret(path.join(userData, "server-secret")) });
      const handlePlay = createPlayHandler({ resolver, streams, auth, registry, hub, hiAnimeUserAgent });
      const handleFile = createFileHandler({ getDownloads, isPathAllowed: isDownloadPath, auth });
      const handleStream = createStreamHandler({ streams, auth, authorizeUrl: authorizePublicUrl });
      server = await startHttpServer({
        port: config.port, host: config.host,
        staticDir: path.join(root, "dist-web"),
        loginHtmlPath: path.join(root, "src/server/login.html"),
        auth, registry, hub, store,
        bootstrap: () => ({ ...bootstrap(), browserSources: BROWSER_SOURCES, downloadDir: config.downloadDir, downloaderDir }),
        // Streams and downloads accept signed links, so they're handled before sign-in.
        handleStream: async (req, res, context) => await handleStream(req, res, context) ||
          await handleFile(req, res, context),
        handleApi: handlePlay,
      });
      timer = setInterval(() => {
        streams.sweep();
        resolver.sweep();
      }, 60000);
      timer.unref();
    },
    async close() {
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
