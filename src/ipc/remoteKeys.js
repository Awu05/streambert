// TV remote mode: remote/keyboard keys for player webviews.
// Handled here (before-input-event) because provider players usually sit in
// a nested cross-origin iframe the renderer can't reach. Off unless the
// renderer turns TV remote mode on, so desktop keys pass through untouched.

const { ipcMain } = require("electron");

const BACK_KEYS = new Set(["Escape", "Backspace", "GoBack", "BrowserBack"]);
const REPEATABLE = {
  ArrowLeft: "seekBack",
  ArrowRight: "seekForward",
  ArrowUp: "volUp",
  ArrowDown: "volDown",
};

function mapRemoteKey(input, enabled) {
  if (!enabled || input.type !== "keyDown") return null;
  if (REPEATABLE[input.key]) return REPEATABLE[input.key];
  const action =
    input.key === "Enter" || input.key === " "
      ? "playPause"
      : BACK_KEYS.has(input.key)
        ? "back"
        : null;
  // Held OK/Back: swallow the repeats so the player doesn't toggle again
  return action && input.isAutoRepeat ? "ignore" : action;
}

const TOAST = `function toast(msg) {
  try {
    var t = document.getElementById("__sbRemoteToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "__sbRemoteToast";
      t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.78);color:#fff;padding:8px 16px;border-radius:8px;font:600 14px system-ui,sans-serif;z-index:2147483647;pointer-events:none;transition:opacity .2s";
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; }, 900);
  } catch (e) {}
}`;

const VIDEO_ACTIONS = {
  playPause: `if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); toast("Play"); } else { v.pause(); toast("Pause"); }`,
  seekBack: `v.currentTime = Math.max(0, v.currentTime - 10); toast("-10s");`,
  seekForward: `v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10); toast("+10s");`,
  volUp: `v.muted = false; v.volume = Math.min(1, v.volume + 0.1); toast("Volume " + Math.round(v.volume * 100) + "%");`,
  volDown: `v.volume = Math.max(0, v.volume - 0.1); toast("Volume " + Math.round(v.volume * 100) + "%");`,
};

// JS expression run in one frame; true if it acted on something there.
function actionScript(action) {
  if (action === "clickCentre") {
    // Click whatever sits at this frame's centre (poster / big play button).
    // Over an <iframe>, returns its index in window.frames to descend into.
    return `(function () { if (innerWidth < 200 || innerHeight < 150) return false; var x = innerWidth / 2, y = innerHeight / 2; var el = document.elementFromPoint(x, y); if (!el) return false; if (el.tagName === "IFRAME" || el.tagName === "FRAME") { var i = Array.prototype.indexOf.call(window.frames, el.contentWindow); return i >= 0 ? i : false; } var o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }; ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) { el.dispatchEvent(t.indexOf("pointer") === 0 ? new PointerEvent(t, Object.assign({ pointerType: "mouse", isPrimary: true }, o)) : new MouseEvent(t, o)); }); return true; })()`;
  }
  if (action === "exitFullscreen") {
    return `(function () { if (!document.fullscreenElement) return false; document.exitFullscreen().catch(function () {}); return true; })()`;
  }
  return `(function () { ${TOAST} var v = document.querySelector("video"); if (!v) return false; ${VIDEO_ACTIONS[action]} return true; })()`;
}

let enabled = false;
let getMainWindow = () => null;

const runIn = (frame, script, userGesture = false) =>
  Promise.resolve()
    .then(() => frame.executeJavaScript(script, userGesture))
    .catch(() => false);

async function run(wc, action) {
  const frames = wc.mainFrame.framesInSubtree;
  if (action === "back") {
    const exited = await Promise.all(
      frames.map((f) => runIn(f, actionScript("exitFullscreen"))),
    );
    if (exited.some(Boolean)) return;
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send("player-remote-back");
    return;
  }
  for (const f of frames) {
    if (await runIn(f, actionScript(action))) return;
  }
  // No <video> yet (poster / play overlay): click the player's centre.
  // Starts at the top and follows the iframe under the centre, so only the
  // visible player is clicked. Done in-page because sendInputEvent clicks
  // don't reach cross-origin iframes.
  if (action === "playPause") {
    let frame = wc.mainFrame;
    for (let depth = 0; frame && depth < 8; depth++) {
      const r = await runIn(frame, actionScript("clickCentre"), true);
      if (typeof r !== "number") return;
      frame = frame.frames[r];
    }
  }
}

function register(getMainWindowFn) {
  getMainWindow = getMainWindowFn;
  ipcMain.on("set-tv-remote-mode", (_, on) => {
    enabled = !!on;
  });
}

function attach(wc) {
  wc.on("before-input-event", (event, input) => {
    const action = mapRemoteKey(input, enabled);
    if (!action) return;
    event.preventDefault();
    if (action !== "ignore") run(wc, action).catch(() => {});
  });
}

module.exports = { mapRemoteKey, actionScript, run, register, attach };
