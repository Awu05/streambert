const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");
const { RpcError, makePathGuard } = require("./ipcRegistry");
const { validateChange } = require("./profileStore");
const { bootstrapStorage, changeError, HOUSEHOLD_ID, splitChange } = require("./profileData");

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    throw new RpcError(415, "Expected JSON");
  }
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
    req.resume();
    throw new RpcError(413, "Request is too large");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      throw new RpcError(413, "Request is too large");
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RpcError(400, "Invalid JSON object");
  }
}

function requestOrigin(req) {
  const host = req.headers.host || "";
  if (!/^(?:\[[a-f0-9:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) {
    throw new RpcError(400, "Invalid host");
  }
  return `${req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${host}`;
}

async function serveFile(res, file, headers = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    "Content-Length": stat.size,
    ...headers,
  });
  await pipeline(fs.createReadStream(file), res);
  return true;
}

// The login page is served before sign-in, so it can't load the app's CSS.
// It reuses the built app's @font-face rules to match the app's fonts.
function loginPage(loginHtmlPath, staticDir) {
  let html;
  try { html = fs.readFileSync(loginHtmlPath, "utf8"); } catch { return null; }
  let fontFaces = "";
  try {
    const assets = path.join(staticDir, "assets");
    fontFaces = fs.readdirSync(assets).filter((name) => /^index-[\w-]+\.css$/.test(name))
      .flatMap((name) => fs.readFileSync(path.join(assets, name), "utf8").match(/@font-face\{[^}]*\}/g) || [])
      .join("\n");
  } catch {}
  return html.replace("/* FONT_FACES */", fontFaces);
}

// Files the login page needs before sign-in. None of them are private.
const isPublicAsset = (pathname) => pathname === "/logo.svg" || /^\/assets\/[\w.-]+\.woff2$/.test(pathname);

function decodedPath(value) {
  try {
    const name = decodeURIComponent(value.split("?")[0]);
    if (!name.startsWith("/") || name.startsWith("//") || /[\\\0]/.test(name) ||
      name.split("/").some((part) => part === ".." || part === ".")) return null;
    return name;
  } catch {
    return null;
  }
}

async function startHttpServer({
  port, host, staticDir, auth, registry, hub, store, bootstrap, loginHtmlPath,
  profiles, handleProfiles, onProfileChange, handleStream, handleApi,
}) {
  const isStaticPath = makePathGuard([staticDir]);
  const staticRoot = path.resolve(staticDir);
  // A file in the web build for a request path, or null.
  const staticFile = (pathname) => {
    const file = path.resolve(staticRoot, "." + pathname);
    return file.startsWith(staticRoot + path.sep) && isStaticPath(file) ? file : null;
  };
  const loginHtml = loginPage(loginHtmlPath, staticDir);
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const pathname = decodedPath(req.url);
      if (!pathname) return json(res, 404, { error: "Not found" });
      const origin = requestOrigin(req);
      const url = new URL(req.url, origin);
      const api = pathname.startsWith("/api/");
      const get = req.method === "GET";
      const post = req.method === "POST";
      if (["POST", "PATCH", "DELETE"].includes(req.method) && req.headers.origin && req.headers.origin !== origin) {
        return json(res, 403, { error: "Invalid origin" });
      }
      if (get && pathname === "/login") {
        if (!loginHtml) return json(res, 404, { error: "Login page missing" });
        res.writeHead(200, {
          "Content-Type": TYPES[".html"],
          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self' data:; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",
        }).end(loginHtml);
        return;
      }
      if (get && isPublicAsset(pathname)) {
        const file = staticFile(pathname);
        if (file && await serveFile(res, file, { "Cache-Control": "public, max-age=86400" })) return;
        return json(res, 404, { error: "Not found" });
      }
      const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}` +
        (origin.startsWith("https:") ? "; Secure" : "");
      const session = /(?:^|;\s*)sb_session=([^;]+)/.exec(req.headers.cookie || "")?.[1];
      if (post && pathname === "/api/login") {
        const { password } = await readJson(req);
        if (!await auth.checkPassword(password)) {
          await delay(1000);
          return json(res, 401, { error: "Wrong password" });
        }
        res.setHeader("Set-Cookie", [cookie("sb_session", auth.issueSession(), 2592000), cookie("sb_profile", "", 0)]);
        hub.disconnectSession(session);
        res.writeHead(204).end();
        return;
      }
      if (post && pathname === "/api/logout") {
        res.setHeader("Set-Cookie", [cookie("sb_session", "", 0), cookie("sb_profile", "", 0)]);
        hub.disconnectSession(session);
        res.writeHead(204).end();
        return;
      }
      const signedIn = auth.verifySession(session);
      const token = signedIn && auth.verifyProfile(/(?:^|;\s*)sb_profile=([^;]+)/.exec(req.headers.cookie || "")?.[1], session);
      const expected = req.headers["x-streambert-profile"] ?? (pathname === "/api/events" ? url.searchParams.get("profile") : null);
      const currentProfile = () => {
        if (!token || !auth.verifySession(session) || (expected && expected !== token.profileId)) return null;
        const record = profiles.get(token.profileId);
        return record?.version === token.version ? record : null;
      };
      const profile = currentProfile();
      const context = { url, origin, signedIn, profile, cookie, currentProfile, session };
      if (await handleStream?.(req, res, context)) return;
      if (!signedIn) {
        if (api) return json(res, 401, { error: "Login required" });
        if (get) return res.writeHead(302, { Location: "/login" }).end();
        return json(res, 404, { error: "Not found" });
      }

      const profileRequired = () => json(res, 409, { error: "Choose a profile", code: "profile" });
      if (api && expected && !profile) return profileRequired();
      if (api && await handleProfiles?.(req, res, context)) return;
      if (api && !profile) return profileRequired();
      if (get && pathname === "/api/bootstrap") {
        return json(res, 200, {
          ...bootstrap(),
          profile: profiles.publicView(profile),
          storage: bootstrapStorage(store.load(profile.id), store.load(HOUSEHOLD_ID), profile),
        });
      }
      if (get && pathname === "/api/events") {
        hub.addClient(res, { profileId: profile.id, session, valid: () => Boolean(currentProfile()) });
        return;
      }
      if (post && pathname === "/api/storage") {
        const { clientId, change } = await readJson(req);
        const active = currentProfile();
        if (!active) return profileRequired();
        if (!validateChange(change)) {
          return json(res, 400, { error: "Invalid storage change" });
        }
        const error = changeError(change, active);
        if (error) return json(res, 403, { error: "Not allowed for this profile", code: error });
        const parts = splitChange(change);
        const except = hub.clientMatches(clientId, active.id) ? clientId : undefined;
        if (parts.profile) {
          const watches = parts.profile.merge?.watched || Object.hasOwn(parts.profile.set ?? {}, "watched") ||
            parts.profile.remove?.includes("watched");
          const before = watches ? store.getValue(active.id, "watched") : undefined;
          store.apply(active.id, parts.profile);
          hub.broadcast("storage-changed", parts.profile, { except, to: (id) => id === active.id });
          if (watches) onProfileChange?.(active, parts.profile, before);
        }
        if (parts.household) {
          store.apply(HOUSEHOLD_ID, parts.household);
          hub.broadcast("storage-changed", parts.household, { except });
        }
        return res.writeHead(204).end();
      }
      if (post && pathname.startsWith("/api/rpc/")) {
        const { args, clientId } = await readJson(req);
        const active = currentProfile();
        if (!active) return profileRequired();
        const client = hub.clientMatches(clientId, active.id) ? hub.clientFor(clientId) : { send() {} };
        const result = await registry.invoke(pathname.slice(9), args, client, { profile: active, currentProfile });
        return json(res, 200, { result });
      }
      if (api && await handleApi?.(req, res, context)) return;
      if (get && !api) {
        const file = staticFile(pathname);
        if (file && await serveFile(res, file, {
          "Cache-Control": pathname.startsWith("/assets/") ? "private, max-age=31536000, immutable" : "no-cache",
        })) return;
        // App routes (no file extension) get the single-page app.
        if (!path.extname(pathname)) {
          const index = staticFile("/index.html");
          if (index && await serveFile(res, index, { "Cache-Control": "no-cache" })) return;
        }
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      if (error instanceof RpcError) json(res, error.status, { error: error.message });
      else {
        console.error("Streambert request failed:", error.message);
        json(res, 500, { error: "Request failed" });
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}

module.exports = { startHttpServer, json, readJson };
