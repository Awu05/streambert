// Streambert: pick the remote screen size once per browser.
// TVs (small CSS viewport) and phones (touch) get a fixed 1920x1080 screen,
// scaled to fit; desktops fill their window at any size or aspect ratio.
// The choice can be changed later in the Selkies sidebar (Screen settings).
(function () {
  var KEY = "streambert_screen";
  try {
    if (localStorage.getItem(KEY)) return;
  } catch (e) {
    return;
  }
  var small = innerWidth < 1200;
  var touch = matchMedia("(pointer: coarse)").matches;
  if (!small && !touch) {
    localStorage.setItem(KEY, "fill");
    return;
  }
  var tries = 0;
  (function send() {
    // Selkies starts listening for messages after it has loaded; retry.
    if (window.manualResolution === true || window.manual_resolution === true) {
      localStorage.setItem(KEY, "fixed");
      return;
    }
    if (tries++ >= 30) return;
    postMessage(
      { type: "setManualResolution", width: 1920, height: 1080 },
      location.origin,
    );
    setTimeout(send, 1000);
  })();
})();

// Touch devices: while typing, ignore the resize caused by the on-screen
// keyboard, so the picture keeps its size and the keyboard just covers the
// bottom (Selkies would shrink it into the strip above the keyboard). Loads
// before Selkies, so this listener runs first.
(function () {
  if (!matchMedia("(pointer: coarse)").matches) return;
  // Selkies' floating keyboard button sits on the video controls (bottom
  // right): move it to the middle of the right edge, smaller and faded.
  var style = document.createElement("style");
  style.textContent =
    ".virtual-keyboard-button{top:50% !important;bottom:auto !important;" +
    "right:8px !important;transform:translateY(-50%) scale(.8);opacity:.4}" +
    ".virtual-keyboard-button:active{opacity:1}";
  document.head.appendChild(style);
  function typing() {
    var a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  }
  // Only while the keyboard actually shrinks the screen: same width, clearly
  // shorter than before. Rotations and a closed keyboard pass through.
  var base = { w: innerWidth, h: innerHeight };
  addEventListener(
    "resize",
    function (e) {
      if (typing() && innerWidth === base.w && innerHeight < base.h * 0.85) {
        e.stopImmediatePropagation();
        return;
      }
      base = { w: innerWidth, h: innerHeight };
    },
    true,
  );
  addEventListener(
    "focusout",
    function () {
      setTimeout(function () {
        if (!typing()) dispatchEvent(new Event("resize"));
      }, 300);
    },
    true,
  );
})();
