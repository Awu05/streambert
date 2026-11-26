const { MAIN_ID, ProfileError } = require("./profiles");
const { json, readJson } = require("./httpServer");

function pinError(res, result) {
  if (result === "ok") return false;
  if (result === "wrong") json(res, 403, { error: "Wrong PIN", code: "wrongPin" });
  else json(res, 429, { error: "Too many PIN attempts", code: "locked", retryAfter: result.lockedFor });
  return true;
}

function createProfileHandler({ profiles, auth, store, hub, beforeDelete = () => {}, downloadBytes = () => 0 }) {
  const deleting = new Set();
  const invalidate = (id) => hub.invalidateProfile(id);
  const choose = (res, cookie, record, session) => {
    res.setHeader("Set-Cookie", cookie("sb_profile", auth.issueProfile(record.id, record.version, session), 2592000));
    res.writeHead(204).end();
  };

  return async (req, res, { url, profile, cookie, currentProfile, session }) => {
    const pathname = url.pathname;
    const method = req.method;
    const root = pathname === "/api/profiles";
    const post = method === "POST";
    const manageList = post && pathname === "/api/profiles/manage";
    const target = /^\/api\/profiles\/([a-z0-9_-]{1,32})$/.exec(pathname)?.[1];
    const manage = manageList || root && post || target && ["PATCH", "DELETE"].includes(method);
    try {
      if (root && method === "GET") {
        json(res, 200, { profiles: profiles.list(), current: profile?.id ?? null });
      } else if (post && pathname === "/api/profiles/leave") {
        res.setHeader("Set-Cookie", cookie("sb_profile", "", 0));
        hub.disconnectSession(session);
        res.writeHead(204).end();
      } else if (post && pathname === "/api/profiles/select") {
        const { id, pin } = await readJson(req);
        const record = profiles.get(id);
        if (!record || deleting.has(id)) throw new ProfileError("notFound");
        if (pinError(res, await profiles.checkPin(id, pin))) return true;
        const latest = profiles.get(id);
        if (!latest || latest.version !== record.version || deleting.has(id)) {
          json(res, 409, { error: "Profile changed", code: "profileChanged" });
        } else {
          hub.disconnectSession(session);
          choose(res, cookie, latest, session);
        }
      } else if (post && pathname === "/api/profiles/me/pin") {
        const { current, pin } = await readJson(req);
        const record = currentProfile();
        if (!record) return false;
        const result = await profiles.setOwnPin(record.id, { current, pin, expectedVersion: record.version });
        if (pinError(res, result)) return true;
        // Other devices in this profile go back to the picker; this one stays in.
        const latest = profiles.get(record.id);
        if (latest.version !== record.version) invalidate(record.id);
        choose(res, cookie, latest, session);
      } else if (manage) {
        const data = await readJson(req);
        if (profile && !profile.main) {
          json(res, 403, { error: "Only the main profile can manage profiles" });
          return true;
        }
        const main = profiles.get(MAIN_ID);
        if (pinError(res, await profiles.checkPin(MAIN_ID, data.pin))) return true;
        if (profiles.get(MAIN_ID).version !== main.version) {
          json(res, 409, { error: "Main PIN changed", code: "profileChanged" });
          return true;
        }
        if (manageList) {
          json(res, 200, profiles.list().map((summary) => {
            const { ageLimit, ratingCountry } = profiles.get(summary.id);
            return { ...summary, ageLimit, ratingCountry, downloadBytes: downloadBytes(summary.id) };
          }));
        } else if (root) {
          const ratingCountry = data.ratingCountry ?? store.getValue(MAIN_ID, "ratingCountry");
          const created = await profiles.create({ ...data, ratingCountry });
          store.apply(created.id, {});
          json(res, 201, created);
        } else {
          const record = profiles.get(target);
          if (!record) throw new ProfileError("notFound");
          if (deleting.has(target)) {
            json(res, 409, { error: "Profile deletion in progress", code: "profileChanged" });
            return true;
          }
          if (method === "PATCH") {
            const ratingCountry = data.ratingCountry ??
              (data.ratingCountry === null || (data.kids === true && !record.kids)
                ? store.getValue(MAIN_ID, "ratingCountry") ?? "US" : undefined);
            const updated = await profiles.update(target, { ...data, ratingCountry });
            if (profiles.get(target).version !== record.version) invalidate(target);
            json(res, 200, updated);
          } else {
            if (record.main) throw new ProfileError("mainLocked");
            deleting.add(target);
            try {
              await beforeDelete(target);
              await profiles.remove(target);
              invalidate(target);
              store.remove(target);
              res.writeHead(204).end();
            } finally {
              deleting.delete(target);
            }
          }
        }
      } else return false;
    } catch (error) {
      if (!(error instanceof ProfileError)) throw error;
      json(res, error.code === "notFound" ? 404 : 400, { error: error.message, code: error.code });
    }
    return true;
  };
}

module.exports = { createProfileHandler };
