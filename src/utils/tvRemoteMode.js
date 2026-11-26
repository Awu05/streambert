import { useEffect, useState } from "react";
import { storage, STORAGE_KEYS } from "./storage";

// "TV remote mode": arrow keys / Enter / Back drive the UI and the player.
// Off until turned on in Settings.

const CHANGED_EVENT = "streambert:tv-remote-settings-changed";

export function isTvRemoteModeEnabled() {
  return storage.get(STORAGE_KEYS.TV_REMOTE_MODE) === true;
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
