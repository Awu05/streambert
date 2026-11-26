const { lookup } = require("node:dns/promises");
const { isIP, BlockList } = require("node:net");

const nonPublic = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
]) nonPublic.addSubnet(ip, bits, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
nonPublic.addSubnet("2001::", 23, "ipv6");
nonPublic.addSubnet("2001:db8::", 32, "ipv6");
nonPublic.addSubnet("2002::", 16, "ipv6");

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !nonPublic.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

function publicUrl(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid upstream address");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? !isPublicAddress(host) : !host.includes(".") || /\.(?:local|localhost)\.?$/.test(host)) {
    throw new Error("Private upstream address");
  }
  return { url, host };
}

async function authorizePublicUrl(value) {
  const { url, host } = publicUrl(value);
  if (isIP(host)) return { url };
  const records = await lookup(host, { all: true });
  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Private upstream address");
  }
  return {
    url,
    lookup: (_name, options, callback) => {
      const addresses = options.family ? records.filter((item) => item.family === options.family) : records;
      const first = addresses[0];
      if (!first) callback(new Error("No matching address"));
      else if (options.all) callback(null, addresses);
      else callback(null, first.address, first.family);
    },
  };
}

module.exports = { authorizePublicUrl, publicUrl };
