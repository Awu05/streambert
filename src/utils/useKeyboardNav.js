import { useEffect, useRef } from "react";
import { mapNavKey } from "./keyboardNavKeys";
import {
  moveGamepadFocus,
  confirmGamepadFocus,
  dismissActiveOverlay,
  ensureInitialFocus,
  setGamepadFocus,
  getGamepadFocus,
  hasActiveOverlay,
  clearGamepadFocus,
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
      if (e.target?.closest?.("[data-web-player]")) return;
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
      // Playing but focus is on the app. Back closes an open dialog, else
      // leaves the player (works even if the player crashed). Other keys go
      // back to the player, unless a dialog is open or the player is blank
      // (pop-out, loading): then they navigate the app's own buttons.
      if (isPlayerGamepadActive()) {
        if (action === "back") {
          if (!dismissActiveOverlay())
            window.dispatchEvent(new CustomEvent(PLAYER_BACK_EVENT));
          return;
        }
        const wv = document.querySelector('webview[partition="persist:player"]');
        const src = wv?.getAttribute("src") || "about:blank";
        if (!hasActiveOverlay() && src !== "about:blank") {
          wv.focus();
          return;
        }
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
      if (action === "select") return void confirmGamepadFocus();
      const wasInSidebar = !!getGamepadFocus()?.closest(".sidebar");
      moveGamepadFocus(action);
      // Left into the sidebar lands on its Back arrow (TV remotes' own Back
      // button may be kept by the browser, e.g. TV Bro)
      if (action === "left" && !wasInSidebar) {
        const back = document.querySelector(".sidebar [data-nav-back]");
        if (back && getGamepadFocus()?.closest(".sidebar")) setGamepadFocus(back);
      }
    };
    // A tap/click moves the highlight too, so OK never acts on a stale item
    const onPointer = (e) => {
      const el = e.target?.closest?.(
        'button, a[href], [role="button"], .card, .sidebar-btn, [tabindex]:not([tabindex="-1"])',
      );
      if (el) setGamepadFocus(el, { scroll: false });
      else clearGamepadFocus();
    };
    // A dialog opened over a playing video: move focus out of the player so
    // the remote drives the dialog; hand it back when the dialog closes.
    let overlayOverPlayer = false;
    const watch = setInterval(() => {
      if (!isPlayerGamepadActive()) return void (overlayOverPlayer = false);
      const wv = document.querySelector('webview[partition="persist:player"]');
      const overlay = hasActiveOverlay();
      if (overlay && !overlayOverPlayer && document.activeElement === wv) {
        wv.blur();
        ensureInitialFocus();
      } else if (!overlay && overlayOverPlayer) wv?.focus();
      overlayOverPlayer = overlay;
    }, 300);
    window.addEventListener("keydown", handler);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      clearInterval(watch);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [enabled]);
}
