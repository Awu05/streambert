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
