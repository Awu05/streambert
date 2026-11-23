import { useEffect, useRef } from "react";
import { mapNavKey } from "./keyboardNavKeys";
import {
  moveGamepadFocus,
  confirmGamepadFocus,
  dismissActiveOverlay,
  ensureInitialFocus,
  setGamepadFocus,
} from "./gamepadSpatialNav";
import { isPlayerGamepadActive } from "./gamepadPlayerState";

// Asks the open player page to stop playback (see MoviePage / TVPage).
export const PLAYER_BACK_EVENT = "streambert:player-remote-back";

/**
 * TV remote / keyboard navigation, reusing the gamepad spatial navigation.
 *  Arrows -> move focus, Enter -> activate, Escape/Backspace/Back -> close
 *  the open modal, else navigate back. No-ops while a player is active.
 */
export function useKeyboardNav({ enabled, onBack }) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = (t?.tagName || "").toUpperCase();
      const inEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        !!t?.isContentEditable;
      const action = mapNavKey({ key: e.key, repeat: e.repeat, inEditable });
      if (!action) return;
      e.preventDefault();
      if (action === "ignore") return;
      // Playing but focus slipped to the app: Back leaves the player (works
      // even if the player crashed); other keys hand focus back to it
      // instead of clicking a stale button.
      if (isPlayerGamepadActive()) {
        if (action === "back")
          window.dispatchEvent(new CustomEvent(PLAYER_BACK_EVENT));
        else document.querySelector('webview[partition="persist:player"]')?.focus();
        return;
      }
      if (action === "back") {
        if (inEditable) t.blur();
        else if (!dismissActiveOverlay()) onBackRef.current?.();
        return;
      }
      if (inEditable) {
        // Navigate from the field itself, then leave it so Enter activates
        // the next item instead of typing into the field.
        setGamepadFocus(t, { scroll: false });
        t.blur();
      }
      ensureInitialFocus();
      if (action === "select") confirmGamepadFocus();
      else moveGamepadFocus(action);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
