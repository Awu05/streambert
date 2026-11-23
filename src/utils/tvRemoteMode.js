import { useEffect, useState } from "react";
import { storage, STORAGE_KEYS } from "./storage";

// "TV remote mode": arrow keys / Enter / Back drive the UI and the player.
// Off by default; the Docker image turns it on via STREAMBERT_TV_MODE=1.

const CHANGED_EVENT = "streambert:tv-remote-settings-changed";

export function resolveTvRemoteMode(stored, envDefault) {
  if (typeof stored === "boolean") return stored;
  return envDefault === true;
}

// Value to store on save, or undefined when the toggle wasn't changed (so an
// untouched setting keeps following the env default).
export const tvRemoteModeToSave = (initial, current) =>
  current !== initial ? current : undefined;

export function isTvRemoteModeEnabled() {
  return resolveTvRemoteMode(
    storage.get(STORAGE_KEYS.TV_REMOTE_MODE),
    globalThis.window?.electron?.envDefaults?.tvRemoteMode,
  );
}

export function setTvRemoteModeEnabled(on) {
  storage.set(STORAGE_KEYS.TV_REMOTE_MODE, !!on);
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function useTvRemoteMode() {
  const [enabled, setEnabled] = useState(isTvRemoteModeEnabled);
  useEffect(() => {
    const handler = () => setEnabled(isTvRemoteModeEnabled());
    window.addEventListener(CHANGED_EVENT, handler);
    return () => window.removeEventListener(CHANGED_EVENT, handler);
  }, []);
  return enabled;
}
