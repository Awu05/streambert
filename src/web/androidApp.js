import { dismissActiveOverlay, hasActiveOverlay } from "../utils/gamepadSpatialNav.js";

let nextId = 0;
const messageListeners = new WeakMap();

export function isAndroidApp() {
  return typeof globalThis.window?.StreambertAndroid?.postMessage === "function";
}

export async function androidRequest(type, payload = {}) {
  if (!isAndroidApp()) throw new Error("Android app bridge is unavailable");
  const bridge = window.StreambertAndroid;
  let pending = messageListeners.get(bridge);
  if (!pending) {
    pending = new Map();
    bridge.onmessage = ({ data }) => {
      try {
        const reply = JSON.parse(data);
        pending.get(reply?.id)?.(reply);
      } catch {}
    };
    messageListeners.set(bridge, pending);
  }

  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The Android app did not respond"));
    }, 15_000);
    pending.set(id, (reply) => {
      clearTimeout(timeout);
      pending.delete(id);
      resolve(reply);
    });
    try {
      bridge.postMessage(JSON.stringify({ ...payload, id, type }));
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(error);
    }
  });
}

export function androidBackAction({ playerOpen, overlayOpen, navDepth }) {
  if (overlayOpen) return "overlay";
  if (playerOpen) return "player";
  if (navDepth > 0) return "nav";
  return null;
}

export function installAndroidBack({ getNavDepth = () => 0, navigateBack } = {}) {
  const handleBack = () => {
    const player = document.querySelector("[data-web-player]");
    const action = androidBackAction({
      playerOpen: !!player,
      overlayOpen: hasActiveOverlay(),
      navDepth: getNavDepth(),
    });
    if (action === "overlay") {
      dismissActiveOverlay();
    }
    if (action === "player") {
      const panel = player.querySelector('[role="menu"]');
      const scope = panel || player;
      const target = scope.contains(document.activeElement) ? document.activeElement : scope;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    }
    if (action === "nav") navigateBack();
    return action !== null;
  };
  window.streambertAndroidBack = handleBack;
  return () => {
    if (window.streambertAndroidBack === handleBack) delete window.streambertAndroidBack;
  };
}
