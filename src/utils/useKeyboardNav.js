import { useEffect, useRef } from "react";
import { mapNavKey } from "./keyboardNavKeys";
import {
  moveGamepadFocus,
  confirmGamepadFocus,
  dismissActiveOverlay,
  ensureInitialFocus,
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
      if (isPlayerGamepadActive()) return;
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
      if (inEditable) t.blur();
      if (action === "back") {
        if (!inEditable && !dismissActiveOverlay()) onBackRef.current?.();
        return;
      }
      ensureInitialFocus();
      if (action === "select") confirmGamepadFocus();
      else moveGamepadFocus(action);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
