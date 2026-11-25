const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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
  const hash = (value) => crypto.createHash("sha256").update(value).digest();
  const passwordHash = hash(password);
  const sign = (value) => crypto.createHmac("sha256", secret).update(value).digest("hex");
  const expiry = (seconds) => String(Math.floor(now() / 1000) + seconds);
  const verify = (value, exp, sig) => /^[0-9]{1,12}$/.test(exp || "") &&
    Number(exp) > Math.floor(now() / 1000) &&
    /^[a-f0-9]{64}$/.test(sig || "") &&
    crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(sign(value), "hex"));
  return {
    checkPassword: (value) => typeof value === "string" && crypto.timingSafeEqual(hash(value), passwordHash),
    issueSession() {
      const exp = expiry(2592000);
      return `${exp}.${sign(`session:${passwordHash.toString("hex")}:${exp}`)}`;
    },
    verifySession(token) {
      if (typeof token !== "string") return false;
      const [exp, sig, extra] = token.split(".");
      return extra === undefined && verify(`session:${passwordHash.toString("hex")}:${exp}`, exp, sig);
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
