import { useCallback, useRef } from "react";
import { findSource } from "./api";

// Callback ref for a player <webview>: sends the source's page rules to the
// main process as soon as the guest exists, so they apply from the first page.
export function useSourceRules(webview, sourceId) {
  const listener = useRef(null);
  return useCallback((element) => {
    if (listener.current) {
      webview.current?.removeEventListener("did-attach", listener.current);
      webview.current?.removeEventListener("dom-ready", listener.current);
    }
    webview.current = element;
    if (!element) return;
    const send = () => {
      try {
        window.electron.setSourceRules(element.getWebContentsId(), findSource(sourceId));
      } catch {} // guest not attached yet; did-attach will send
    };
    listener.current = send;
    element.addEventListener("did-attach", send);
    element.addEventListener("dom-ready", send);
    send();
  }, [webview, sourceId]);
}
