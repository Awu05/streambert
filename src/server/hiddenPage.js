const { setTimeout: delay } = require("node:timers/promises");
const { getStreamRequestMeta } = require("../ipc/streamRequestMeta");
const { authorizePublicUrl, publicUrl } = require("./netGuard");

function createHiddenPageCapture({ BrowserWindow, clickPlayDeep, buildCleanUserAgent, extractSubtitleLang }) {
  const windows = new Map();
  const requests = new Map();
  const hosts = new Map();

  return {
    async checkRequest(details) {
      try {
        const { url, host } = publicUrl(details.url);
        let known = hosts.get(host);
        if (!known || known.expires <= Date.now()) {
          if (hosts.size >= 512) hosts.delete(hosts.keys().next().value);
          known = { expires: Date.now() + 60000, allowed: authorizePublicUrl(url).then(() => true, () => false) };
          hosts.set(host, known);
        }
        return await known.allowed;
      } catch {
        return false;
      }
    },
    beforeSend(details) {
      const capture = windows.get(details.webContentsId);
      if (!capture) return;
      capture.requests.add(details.id);
      requests.set(details.id, getStreamRequestMeta(details));
    },
    onResponse(details) {
      const capture = windows.get(details.webContentsId);
      const headers = requests.get(details.id);
      requests.delete(details.id);
      capture?.requests.delete(details.id);
      if (!capture || !headers || details.statusCode < 200 || details.statusCode >= 300) return;
      const type = Object.entries(details.responseHeaders || {})
        .find(([name]) => name.toLowerCase() === "content-type")?.[1]?.join(";") || "";
      const pathname = new URL(details.url).pathname;
      if (/\.m3u8$/i.test(pathname) || /mpegurl/i.test(type)) {
        capture.media ||= { url: details.url, kind: "hls", headers };
      } else if (/\.vtt$/i.test(pathname) || /text\/vtt/i.test(type)) {
        capture.subtitles.set(details.url, extractSubtitleLang(details.url) || "und");
      }
    },
    onError(details) {
      requests.delete(details.id);
      windows.get(details.webContentsId)?.requests.delete(details.id);
    },
    async openPage({ url, cleanUa }, signal) {
      const window = new BrowserWindow({
        show: false, width: 1280, height: 720,
        webPreferences: {
          partition: "persist:player", backgroundThrottling: false,
          sandbox: true, contextIsolation: true, autoplayPolicy: "no-user-gesture-required",
        },
      });
      const wc = window.webContents;
      const id = wc.id;
      const capture = { media: null, subtitles: new Map(), requests: new Set() };
      windows.set(id, capture);
      wc.setAudioMuted(true);
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      const abort = () => { if (!window.isDestroyed()) window.destroy(); };
      signal.addEventListener("abort", abort, { once: true });
      const navigation = wc.loadURL(url, cleanUa ? { userAgent: buildCleanUserAgent() } : undefined);
      let loadError;
      navigation.catch((error) => { loadError = error; });
      try {
        let nextClickAt = Date.now() + 2500;
        let clicks = 0;
        while (!capture.media) {
          if (loadError && loadError.code !== "ERR_ABORTED") throw new Error("Could not load the source");
          if (Date.now() >= nextClickAt && clicks < 4) {
            nextClickAt = Date.now() + 3500;
            clicks++;
            const blocked = await wc.executeJavaScript(
              '/just a moment|verify you are human|access denied/i.test(document.title + " " + document.body?.innerText.slice(0, 300))',
            ).catch(() => false);
            if (blocked) throw new Error("The provider requires verification");
            if (!capture.media) void clickPlayDeep(wc).catch(() => {});
          }
          await delay(100, undefined, { signal });
        }
        await delay(1200, undefined, { signal });
        return {
          ...capture.media,
          subtitles: [...capture.subtitles].map(([url, lang]) => ({ url, lang })),
        };
      } catch (error) {
        throw signal.aborted ? signal.reason : error;
      } finally {
        signal.removeEventListener("abort", abort);
        windows.delete(id);
        for (const request of capture.requests) requests.delete(request);
        if (!window.isDestroyed()) window.destroy();
      }
    },
  };
}

module.exports = { createHiddenPageCapture };
