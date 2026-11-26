// TV remote mode: remote/keyboard keys for player webviews.
// Handled here (before-input-event) because provider players usually sit in
// a nested cross-origin iframe the renderer can't reach. Off unless the
// renderer turns TV remote mode on, so desktop keys pass through untouched.

const { ipcMain, webFrameMain } = require("electron");

const BACK_KEYS = new Set(["Escape", "Backspace", "GoBack", "BrowserBack"]);
const REPEATABLE = { ArrowLeft: "seekBack", ArrowRight: "seekForward" };
// Down twice leaves (TV Bro keeps the remote's Back button for itself)
const DOUBLE_DOWN_MS = 2000;

function mapRemoteKey(input, enabled, { editable = false } = {}) {
  if (!enabled || input.type !== "keyDown") return null;
  // Shortcuts and typing in the page's own text boxes pass through
  if (input.control || input.alt || input.meta || editable) return null;
  if (REPEATABLE[input.key]) return REPEATABLE[input.key];
  const action =
    input.key === "Enter" || input.key === " "
      ? "playPause"
      : BACK_KEYS.has(input.key)
        ? "back"
        : input.key === "ArrowDown"
          ? "downPress"
          : null;
  // Held OK/Back/Down: swallow the repeats so nothing fires twice
  return action && input.isAutoRepeat ? "ignore" : action;
}

// Injected into every player frame: reports text-box focus via the console,
// which main reads synchronously when deciding whether to take a key.
const FOCUS_REPORTER = `(function () {
  if (window.__sbFocusReporter) return;
  window.__sbFocusReporter = true;
  function ed(el) {
    return !!el && (el.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) &&
      !/^(button|checkbox|radio|range|submit|reset|image|file|color)$/i.test(el.type || "")));
  }
  document.addEventListener("focusin", function (e) { if (ed(e.target)) console.debug("__sb_editable:1"); }, true);
  document.addEventListener("focusout", function (e) { if (ed(e.target)) console.debug("__sb_editable:0"); }, true);
})()`;

const editable = new WeakMap();
const isEditableFocused = (wc) => editable.get(wc) === true;
function noteConsoleMessage(wc, message) {
  if (message === "__sb_editable:1") editable.set(wc, true);
  else if (message === "__sb_editable:0") editable.set(wc, false);
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

// The frame's main video: the largest visible one that has a source, so
// hidden ad/preview videos are ignored.
const PICK_VIDEO = `var vs = document.querySelectorAll("video"), v = null, best = 0;
  for (var j = 0; j < vs.length; j++) {
    var c = vs[j], r = c.getBoundingClientRect();
    if (r.width < 100 || r.height < 60 || !(c.readyState > 0 || c.currentSrc)) continue;
    if (r.width * r.height > best) { best = r.width * r.height; v = c; }
  }`;

const VIDEO_ACTIONS = {
  playPause: `if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); toast("Play"); } else { v.pause(); toast("Pause"); }`,
  seekBack: `v.currentTime = Math.max(0, v.currentTime - 10); toast("-10s");`,
  seekForward: `v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10); toast("+10s");`,
};

// JS expression run in one frame; true if it acted on something there.
function actionScript(action) {
  if (action === "clickCentre") {
    // Click whatever sits at this frame's centre (poster / big play button).
    // Over an <iframe>, returns its src and index so main can descend into it.
    return `(function () { if (innerWidth < 200 || innerHeight < 150) return false; var x = innerWidth / 2, y = innerHeight / 2; var el = document.elementFromPoint(x, y); if (!el) return false; if (el.tagName === "IFRAME" || el.tagName === "FRAME") { var i = Array.prototype.indexOf.call(window.frames, el.contentWindow); return el.src || i >= 0 ? { src: el.src || "", i: i } : false; } var o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }; ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) { el.dispatchEvent(t.indexOf("pointer") === 0 ? new PointerEvent(t, Object.assign({ pointerType: "mouse", isPrimary: true }, o)) : new MouseEvent(t, o)); }); return true; })()`;
  }
  if (action === "hint") {
    return `(function () { ${TOAST} if (!document.querySelector("video")) return false; toast("Press ↓ again to exit"); return true; })()`;
  }
  if (action === "exitFullscreen") {
    return `(function () { if (!document.fullscreenElement) return false; document.exitFullscreen().catch(function () {}); return true; })()`;
  }
  return `(function () { ${TOAST} ${PICK_VIDEO} if (!v) return false; ${VIDEO_ACTIONS[action]} return true; })()`;
}

let enabled = false;
let getMainWindow = () => null;

const runIn = (frame, script, userGesture = false) =>
  Promise.resolve()
    .then(() => frame.executeJavaScript(script, userGesture))
    .catch(() => false);

const lastDown = new WeakMap();

async function clickPlayDeep(wc) {
  let frame = wc.mainFrame;
  for (let depth = 0; frame && depth < 8; depth++) {
    const result = await runIn(frame, actionScript("clickCentre"), true);
    if (!result || typeof result !== "object") return result === true;
    const children = frame.frames || [];
    frame = (result.src && children.find((child) => child.url === result.src)) || children[result.i];
  }
  return false;
}

async function run(wc, action, now = Date.now(), getMw = getMainWindow) {
  const frames = wc.mainFrame.framesInSubtree;
  if (action === "downPress") {
    const prev = lastDown.get(wc);
    if (prev != null && now - prev <= DOUBLE_DOWN_MS) {
      lastDown.delete(wc);
      action = "back";
    } else {
      lastDown.set(wc, now);
      for (const f of frames) {
        if (await runIn(f, actionScript("hint"))) return;
      }
      return;
    }
  }
  if (action === "back") {
    const exited = await Promise.all(
      frames.map((f) => runIn(f, actionScript("exitFullscreen"))),
    );
    if (exited.some(Boolean)) return;
    const mw = getMw();
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
    await clickPlayDeep(wc);
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
    const action = mapRemoteKey(input, enabled, {
      editable: isEditableFocused(wc),
    });
    if (!action) return;
    event.preventDefault();
    if (action !== "ignore") run(wc, action).catch(() => {});
  });
  wc.on("console-message", (e, _level, message) =>
    noteConsoleMessage(wc, e?.message ?? message),
  );
  wc.on("did-frame-finish-load", (_e, isMainFrame, processId, routingId) => {
    if (isMainFrame) editable.set(wc, false);
    if (!enabled) return; // desktop default: leave provider pages untouched
    try {
      webFrameMain
        .fromId(processId, routingId)
        ?.executeJavaScript(FOCUS_REPORTER)
        .catch(() => {});
    } catch {}
  });
}

module.exports = {
  mapRemoteKey,
  actionScript,
  run,
  register,
  attach,
  clickPlayDeep,
  noteConsoleMessage,
  isEditableFocused,
};
