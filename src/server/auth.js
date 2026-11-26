const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { PROFILE_ID } = require("./profiles");

const scrypt = promisify(crypto.scrypt);

function loadOrCreateSecret(filename) {
  try {
    const existing = fs.readFileSync(filename);
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const secret = crypto.randomBytes(32);
  const temp = filename + "." + crypto.randomUUID();
  fs.writeFileSync(temp, secret, { mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temp, filename);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return secret;
}

function createAuth({ password, secret, now = Date.now }) {
  // scrypt keeps password guessing slow. Sessions are signed with the derived
  // key, so changing the password signs every device out.
  const passwordKey = crypto.scryptSync(password, secret, 32);
  const signer = (key) => (value) => crypto.createHmac("sha256", key).update(value).digest("hex");
  const signSession = signer(passwordKey);
  const signLink = signer(secret);
  const expiry = (seconds) => String(Math.floor(now() / 1000) + seconds);
  const verify = (sign, value, exp, sig) => /^[0-9]{1,12}$/.test(exp || "") &&
    Number(exp) > Math.floor(now() / 1000) &&
    /^[a-f0-9]{64}$/.test(sig || "") &&
    crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sign(value), "hex"));
  return {
    async checkPassword(value) {
      return typeof value === "string" && crypto.timingSafeEqual(await scrypt(value, secret, 32), passwordKey);
    },
    issueSession() {
      const exp = expiry(2592000);
      return `${exp}.${signSession(`session:${exp}`)}`;
    },
    verifySession(token) {
      if (typeof token !== "string") return false;
      const [exp, sig, extra] = token.split(".");
      return extra === undefined && verify(signSession, `session:${exp}`, exp, sig);
    },
    issueProfile(profileId, version) {
      const exp = expiry(2592000);
      return `${profileId}.${version}.${exp}.${signSession(`profile:${profileId}:${version}:${exp}`)}`;
    },
    verifyProfile(token) {
      if (typeof token !== "string") return null;
      const [profileId, version, exp, sig, extra] = token.split(".");
      if (extra !== undefined || !PROFILE_ID.test(profileId) || !/^\d{1,9}$/.test(version) ||
          !verify(signSession, `profile:${profileId}:${version}:${exp}`, exp, sig)) return null;
      return { profileId, version: Number(version) };
    },
    signUrl(resource, seconds) {
      const exp = expiry(seconds);
      return `exp=${exp}&sig=${signLink(`url:${resource}:${exp}`)}`;
    },
    verifyUrl(resource, exp, sig) {
      return verify(signLink, `url:${resource}:${exp}`, exp, sig);
    },
  };
}

module.exports = { createAuth, loadOrCreateSecret };
