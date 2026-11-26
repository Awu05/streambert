export function mapPlayerKey({ key, repeat }, { lastDownAt, now }) {
  let action = null;
  if (key === "Enter" || key === " ") action = repeat ? "ignore" : "playPause";
  if (key === "ArrowLeft" || key === "ArrowRight") action = key === "ArrowLeft" ? "seekBack" : "seekForward";
  if (key === "ArrowUp") action = "showControls";
  if (["Escape", "Backspace", "GoBack", "BrowserBack"].includes(key)) action = repeat ? "ignore" : "exit";
  if (key === "ArrowDown") {
    if (repeat) action = "ignore";
    else if (lastDownAt !== null && now - lastDownAt <= 2000) {
      action = "exit";
      lastDownAt = null;
    } else {
      action = "hintExit";
      lastDownAt = now;
    }
  }
  return { action, lastDownAt };
}
