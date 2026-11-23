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
      // Playing but focus slipped to the app: hand it back to the player
      // (main handles the keys there) instead of clicking a stale button.
      if (isPlayerGamepadActive()) {
        document.querySelector("webview")?.focus();
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
