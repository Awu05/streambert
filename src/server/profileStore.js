const fs = require("node:fs");
const path = require("node:path");

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validKey = (key) => typeof key === "string" && key.length > 0 &&
  key.length <= 256 && !["__proto__", "constructor", "prototype"].includes(key);

function validateChange(change) {
  if (!isRecord(change)) return false;
  for (const [op, entries] of Object.entries(change)) {
    if (op === "remove") {
      if (!Array.isArray(entries) || !entries.every(validKey)) return false;
    } else if (op === "set" || op === "merge") {
      if (!isRecord(entries) || !Object.keys(entries).every(validKey)) return false;
      if (op === "merge" && !Object.values(entries).every((value) =>
        isRecord(value) && Object.keys(value).every(validKey))) return false;
    } else return false;
  }
  return true;
}

function createProfileStore(baseDir, { debounceMs = 300 } = {}) {
  const profiles = new Map();
  let timer;

  function get(profileId) {
    if (typeof profileId !== "string" || !/^[a-z0-9_-]{1,32}$/.test(profileId)) {
      throw new Error("bad profile id");
    }
    if (profiles.has(profileId)) return profiles.get(profileId);
    const file = path.join(baseDir, "profiles", profileId, "storage.json");
    const profile = { file, data: Object.create(null), dirty: false };
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isRecord(data)) throw new SyntaxError("Expected a profile object");
      Object.assign(profile.data, data);
    } catch (error) {
      if (error instanceof SyntaxError) {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        console.warn("Recovered from invalid profile storage");
      } else if (error.code !== "ENOENT") throw error;
    }
    profiles.set(profileId, profile);
    return profile;
  }

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    for (const profile of profiles.values()) {
      if (!profile.dirty) continue;
      fs.mkdirSync(path.dirname(profile.file), { recursive: true });
      const temp = profile.file + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(profile.data), { mode: 0o600 });
      fs.renameSync(temp, profile.file);
      profile.dirty = false;
    }
  }

  return {
    load: (id) => structuredClone(get(id).data),
    apply(id, change) {
      if (!validateChange(change)) throw new TypeError("Invalid storage change");
      const profile = get(id);
      const { set, merge, remove } = structuredClone(change);
      Object.assign(profile.data, set);
      for (const [key, entries] of Object.entries(merge || {})) {
        const current = profile.data[key];
        const updated = Object.assign(Object.create(null), isRecord(current) ? current : {});
        for (const [entry, value] of Object.entries(entries)) {
          if (value === null) delete updated[entry];
          else updated[entry] = value;
        }
        profile.data[key] = updated;
      }
      for (const key of remove || []) delete profile.data[key];
      profile.dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          flush();
        } catch (error) {
          console.error("Could not save profile storage:", error.message);
        }
      }, debounceMs);
      timer.unref();
    },
    async flush() {
      flush();
    },
  };
}

module.exports = { createProfileStore, validateChange };
