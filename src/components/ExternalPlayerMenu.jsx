import React, { useState } from "react";
import { externalLinks } from "../web/externalLinks";

// The "Open in another app" row of the browser player's Options panel.
export function useExternalPlayerMenu(href, kind) {
  const [copyResult, setCopyResult] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopyResult("copied");
    } catch { setCopyResult("manual"); }
  }
  if (!href) return null;
  return {
    id: "external", label: "Open in another app",
    status: copyResult === "copied" ? "Link copied" : undefined,
    items: [
      ...externalLinks(href, { userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints, kind })
        .map((link) => ({ key: link.label, label: link.label, href: link.href })),
      { key: "copy", label: "Copy link", keepOpen: true, onSelect: copy },
    ],
    extra: copyResult === "manual" && <input className="web-player-link" aria-label="Stream link" value={href} readOnly
      autoFocus onFocus={(event) => event.target.select()} />,
    note: "Progress isn’t tracked in other apps. Links expire after six hours.",
  };
}
