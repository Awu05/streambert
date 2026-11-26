const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

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
  // scrypt keeps password guessing slow; the key also ties sessions to the password.
  const passwordKey = crypto.scryptSync(password, secret, 32);
  const passwordTag = passwordKey.toString("hex");
  const sign = (value) => crypto.createHmac("sha256", secret).update(value).digest("hex");
  const expiry = (seconds) => String(Math.floor(now() / 1000) + seconds);
  const verify = (value, exp, sig) => /^[0-9]{1,12}$/.test(exp || "") &&
    Number(exp) > Math.floor(now() / 1000) &&
    /^[a-f0-9]{64}$/.test(sig || "") &&
    crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sign(value), "hex"));
  return {
    async checkPassword(value) {
      return typeof value === "string" && crypto.timingSafeEqual(await scrypt(value, secret, 32), passwordKey);
    },
    issueSession() {
      const exp = expiry(2592000);
      return `${exp}.${sign(`session:${passwordTag}:${exp}`)}`;
    },
    verifySession(token) {
      if (typeof token !== "string") return false;
      const [exp, sig, extra] = token.split(".");
      return extra === undefined && verify(`session:${passwordTag}:${exp}`, exp, sig);
    },
    signUrl(resource, seconds) {
      const exp = expiry(seconds);
      return `exp=${exp}&sig=${sign(`url:${resource}:${exp}`)}`;
    },
    verifyUrl(resource, exp, sig) {
      return verify(`url:${resource}:${exp}`, exp, sig);
    },
  };
}

module.exports = { createAuth, loadOrCreateSecret };
