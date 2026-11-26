function getStreamRequestMeta(details) {
  const headers = Object.fromEntries(
    Object.entries(details.requestHeaders || {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  let pageUrl = "";
  try {
    pageUrl = details.frame?.url || details.webContents?.getURL() || "";
  } catch {}
  return {
    referer: headers.referer || details.referrer || pageUrl,
    origin: headers.origin || (/^https?:/.test(pageUrl) ? new URL(pageUrl).origin : ""),
    userAgent: headers["user-agent"] || "",
  };
}

module.exports = { getStreamRequestMeta };
