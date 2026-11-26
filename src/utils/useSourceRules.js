import { useCallback, useRef } from "react";
import { findSource } from "./api";

export function useSourceRules(webview, sourceId) {
  const listener = useRef(null);
  return useCallback((element) => {
    if (listener.current) webview.current?.removeEventListener("dom-ready", listener.current);
    webview.current = element;
    if (!element) return;
    const apply = () => window.electron.setSourceRules(element.getWebContentsId(), findSource(sourceId));
    listener.current = apply;
    element.addEventListener("dom-ready", apply);
  }, [webview, sourceId]);
}
