function detectPlatform(userAgent, touchPoints = 0) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

export function externalLinks(streamUrl, { userAgent, touchPoints, kind } = {}) {
  const platform = detectPlatform(userAgent, touchPoints);
  const url = encodeURIComponent(streamUrl);
  if (platform === "ios") return [
    { label: "VLC", href: `vlc-x-callback://x-callback-url/stream?url=${url}` },
    { label: "Infuse", href: `infuse://x-callback-url/play?url=${url}` },
  ];
  if (platform === "android") {
    const target = new URL(streamUrl);
    const scheme = target.protocol.slice(0, -1);
    const mime = kind === "mp4" ? "video/mp4" : "application/vnd.apple.mpegurl";
    return [{
      label: "Open with…",
      href: `intent:${target.href.slice(target.protocol.length)}#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=${mime};end`,
    }];
  }
  return [{ label: "VLC", href: `vlc://${streamUrl}` }];
}
