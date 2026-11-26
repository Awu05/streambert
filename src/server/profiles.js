const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const COLORS = ["#e50914", "#f5a623", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e84393", "#7f8c8d"];
const MAX_PROFILES = 8;
const MAIN_ID = "default";
const PIN = /^\d{4}$/;
const AGE_LIMITS = new Set(["0", "7", "12", "13", "15", "16", "17", "18"]);
const PROFILE_ID = /^[a-z0-9_-]{1,32}$/;

class ProfileError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function details({ name, color, kids = false, ageLimit, ratingCountry }, main) {
  if (typeof name !== "string" || !name.trim() || [...name.trim()].length > 20) {
    throw new ProfileError("invalidName");
  }
  if (!COLORS.includes(color)) throw new ProfileError("invalidColor");
  if (typeof kids !== "boolean") throw new ProfileError("invalidKids");
  if (main && kids) throw new ProfileError("mainLocked");
  if (kids && !AGE_LIMITS.has(ageLimit)) throw new ProfileError("invalidAge");
  if (kids && (typeof ratingCountry !== "string" || !/^[A-Z]{2}$/.test(ratingCountry))) {
    throw new ProfileError("invalidCountry");
  }
  return { name: name.trim(), color, kids, ageLimit: kids ? ageLimit : null, ratingCountry: kids ? ratingCountry : null };
}

function publicView(record) {
  const { id, name, color, kids, main, pin } = record;
  return { id, name, color, kids, main, hasPin: pin !== null };
}

function createProfiles({ file, now = Date.now, scrypt = promisify(crypto.scrypt) }) {
  const fails = new Map();
  const pending = new Map();
  let records;

  function save(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temp, file);
    records = next;
  }

  try {
    records = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(records) || records.length > MAX_PROFILES ||
        new Set(records.map((record) => record?.id)).size !== records.length ||
        !records.some((record) => record?.id === MAIN_ID) ||
        records.some((record) => !record || !PROFILE_ID.test(record.id) || record.id === "household" ||
          record.main !== (record.id === MAIN_ID) || !Number.isSafeInteger(record.version) || record.version < 1 ||
          (record.pin !== null && (!/^[a-f0-9]{32}$/.test(record.pin?.salt) || !/^[a-f0-9]{64}$/.test(record.pin?.hash))))) {
      throw new Error("Invalid profile registry");
    }
    for (const record of records) details(record, record.main);
  } catch (error) {
    // A damaged registry isn't reset silently: that would drop every PIN and kids limit.
    if (error.code !== "ENOENT") {
      throw new Error(`Could not read ${file} (${error.message}). Fix it, or move it aside to start again ` +
        "with one main profile (all PINs and kids settings are then reset; viewing data is kept).");
    }
    save([{
      id: MAIN_ID, name: "Main", color: COLORS[0], kids: false, ageLimit: null,
      ratingCountry: null, main: true, version: 1, pin: null,
    }]);
  }

  const get = (id) => records.find((record) => record.id === id) ?? null;
  function requireProfile(id) {
    const record = get(id);
    if (!record) throw new ProfileError("notFound");
    return record;
  }

  function replace(record) {
    save(records.map((item) => item.id === record.id ? record : item));
  }

  async function withPinQueue(id, operation) {
    const previous = pending.get(id);
    const next = (previous ?? Promise.resolve()).then(operation, operation);
    pending.set(id, next);
    try {
      return await next;
    } finally {
      if (pending.get(id) === next) pending.delete(id);
    }
  }

  async function check(record, pin) {
    if (!record.pin) return "ok";
    const fail = fails.get(record.id);
    if (fail?.until > now()) return { lockedFor: Math.ceil((fail.until - now()) / 1000) };
    if (typeof pin === "string" && PIN.test(pin)) {
      const hash = await scrypt(pin, Buffer.from(record.pin.salt, "hex"), 32);
      if (get(record.id)?.version !== record.version) return "wrong";
      if (crypto.timingSafeEqual(hash, Buffer.from(record.pin.hash, "hex"))) {
        fails.delete(record.id);
        return "ok";
      }
    }
    const count = (fail?.until ? 0 : fail?.count ?? 0) + 1;
    const until = count >= 5 ? now() + 300000 : 0;
    fails.set(record.id, { count, until });
    return until ? { lockedFor: 300 } : "wrong";
  }

  function clearPin(record) {
    if (!record.pin) return false;
    replace({ ...record, pin: null, version: record.version + 1 });
    fails.delete(record.id);
    return true;
  }

  return {
    get,
    publicView,
    list: () => records.map(publicView),
    async create(data) {
      if (records.length >= MAX_PROFILES) throw new ProfileError("tooMany");
      const fields = details({ ...data, ratingCountry: data.ratingCountry ?? "US" }, false);
      let id;
      do {
        id = "p-" + crypto.randomBytes(5).toString("hex");
      } while (get(id));
      const record = { ...fields, id, main: false, version: 1, pin: null };
      save([...records, record]);
      return publicView(record);
    },
    async update(id, { name, color, kids, ageLimit, ratingCountry, removePin }) {
      const current = requireProfile(id);
      if (current.main && removePin) throw new ProfileError("mainLocked");
      const fields = details({
        name: name === undefined ? current.name : name,
        color: color === undefined ? current.color : color,
        kids: kids === undefined ? current.kids : kids,
        ageLimit: ageLimit === undefined ? current.ageLimit : ageLimit,
        ratingCountry: ratingCountry === undefined ? current.ratingCountry : ratingCountry,
      }, current.main);
      const cleared = removePin === true && current.pin !== null;
      const restrictionChanged = fields.kids !== current.kids || fields.ageLimit !== current.ageLimit ||
        fields.ratingCountry !== current.ratingCountry;
      const record = {
        ...current, ...fields,
        pin: cleared ? null : current.pin,
        version: cleared || restrictionChanged ? current.version + 1 : current.version,
      };
      replace(record);
      if (cleared) fails.delete(id);
      return publicView(record);
    },
    async remove(id) {
      const record = requireProfile(id);
      if (record.main) throw new ProfileError("mainLocked");
      save(records.filter((item) => item.id !== id));
      fails.delete(id);
    },
    checkPin(id, pin) {
      return withPinQueue(id, () => check(requireProfile(id), pin));
    },
    setOwnPin(id, { current, pin, expectedVersion }) {
      if (pin !== null && (typeof pin !== "string" || !PIN.test(pin))) {
        return Promise.reject(new ProfileError("invalidPin"));
      }
      return withPinQueue(id, async () => {
        const record = requireProfile(id);
        if (expectedVersion !== undefined && record.version !== expectedVersion) return "wrong";
        const result = await check(record, current);
        if (result !== "ok" || (!record.pin && pin === null)) return result;
        const salt = pin === null ? null : crypto.randomBytes(16);
        const hash = salt && await scrypt(pin, salt, 32);
        const latest = requireProfile(id);
        if (latest.version !== record.version) return "wrong";
        const credential = salt ? { salt: salt.toString("hex"), hash: hash.toString("hex") } : null;
        replace({ ...latest, pin: credential, version: latest.version + 1 });
        return "ok";
      });
    },
    resetMainPin: () => clearPin(requireProfile(MAIN_ID)),
  };
}

module.exports = { createProfiles, ProfileError, COLORS, MAX_PROFILES, MAIN_ID, PROFILE_ID };
