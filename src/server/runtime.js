const fs = require("node:fs");
const path = require("node:path");
const { createAuth, loadOrCreateSecret } = require("./auth");
const { createProfileStore } = require("./profileStore");
const { startHttpServer } = require("./httpServer");
const { RpcError, makePathGuard } = require("./ipcRegistry");
const { authorizePublicUrl } = require("./netGuard");
const { SOURCE_MODES } = require("./sourceModes");
const { createResolver } = require("./resolver");
const { createStreamRegistry, createStreamHandler, streamLink } = require("./streams");
const { createPlayHandler } = require("./playRoutes");
const { createFileHandler } = require("./fileRoutes");

function createServerRuntime({ config, userData, root, hub, openPage, bootstrap, getDownloads, hiAnimeUserAgent }) {
  const resolver = createResolver({ maxPages: config.maxHiddenPages, openPage });
  const streams = createStreamRegistry();
  const store = createProfileStore(userData);
  const isDownloadPath = makePathGuard([config.downloadDir]);
  const downloaderDir = config.allowedDirs[0] || "";
  const bindAddress = config.host === "0.0.0.0" ? "127.0.0.1" :
    config.host.includes(":") ? (config.host === "::" ? "[::1]" : `[${config.host}]`) : config.host;
  let auth;
  let timer;
  let server;
  hub.onClientRemoved(resolver.cancel);

  function prepare(channel, args) {
    const [value] = args;
    if (channel === "check-downloader") {
      if (!downloaderDir) return [undefined];
      return [downloaderDir];
    }
    if (channel === "run-download") {
      const id = typeof value?.m3u8Url === "string" &&
        /^(?:https?:\/\/[^/]+)?\/s\/([a-f0-9]{32})\/index\.(?:m3u8|mp4)(?:\?|$)/.exec(value.m3u8Url)?.[1];
      const entry = id && streams.get(id);
      if (!entry || !auth || typeof value.name !== "string") {
        throw new RpcError(403, "Choose a resolved stream to download");
      }
      const origin = `http://${bindAddress}:${config.port}`;
      const link = streamLink(origin, entry, auth);
      const signature = new URL(link).search;
      const selected = new Set(Array.isArray(value.subtitles) ? value.subtitles.map((item) => String(item?.url ?? "").split("?")[0]) : []);
      const subtitles = (entry.subtitles || []).flatMap((subtitle) => {
        try {
          const resource = entry.pathFor(subtitle.url);
          return selected.has(resource)
            ? [{ url: origin + resource + signature, lang: subtitle.lang, name: "subtitles.vtt" }]
            : [];
        } catch {
          return [];
        }
      });
      return [{
        ...value,
        name: value.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+|[. ]+$/g, "").slice(0, 180) || "Streambert video",
        downloadPath: config.downloadDir,
        subtitles,
        m3u8Url: link,
      }];
    }
    if (["delete-download", "delete-subtitle-file", "download-subtitles-for-file"].includes(channel)) {
      const field = channel === "delete-subtitle-file" ? "subtitlePath" : "filePath";
      const file = value?.[field];
      if (file && !isDownloadPath(file)) throw new RpcError(403, "Path not allowed");
    }
    if (channel === "get-subtitle-url" || channel === "download-subtitles-for-file") {
      const selected = channel === "get-subtitle-url" ? [{ file_id: value?.fileId }] : value?.selectedSubs;
      if (!Array.isArray(selected)) throw new RpcError(400, "Invalid subtitles");
      for (const sub of selected) {
        try {
          if (typeof sub.file_id !== "string") throw new Error();
          const encoded = sub.file_id.split("_").slice(2).join("_");
          if (sub.file_id.startsWith("subdl_")) {
            const source = decodeURIComponent(encoded);
            if (!source.startsWith("/") || source.startsWith("//") || source.includes("\\")) throw new Error();
            continue;
          }
          if (!sub.file_id.startsWith("wyzie_")) throw new Error();
          const url = new URL(sub.direct_url || decodeURIComponent(encoded));
          if (url.protocol !== "https:" || url.username || url.password) throw new Error();
          if (channel !== "get-subtitle-url" &&
            !["https://subs.wyzie.ru", "https://sub.wyzie.io"].includes(url.origin)) throw new Error();
        } catch {
          throw new RpcError(403, "Subtitle source not allowed");
        }
      }
    }
    if (channel === "delete-all-downloads" || channel === "delete-download") {
      const entries = getDownloads().filter((item) => channel === "delete-all-downloads" || item.id === value?.id);
      const paths = entries.flatMap((item) => [item.filePath, item.downloadPath,
        ...(item.subtitlePaths || []).map((sub) => sub.path || sub)]);
      if (paths.some((file) => file && !isDownloadPath(file))) throw new RpcError(403, "Path not allowed");
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
        bootstrap: () => ({ ...bootstrap(), sourceModes: SOURCE_MODES, downloadDir: config.downloadDir, downloaderDir }),
        // Streams and downloaded files accept signed links, so they're checked before sign-in.
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
