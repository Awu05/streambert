// Maps a keydown to a TV-remote navigation action (see useKeyboardNav).
// In text fields only Up/Down (leave the field) and Escape (back) navigate.

const DIRECTIONS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
const BACK_KEYS = new Set(["Escape", "Backspace", "GoBack", "BrowserBack"]);

export function mapNavKey({ key, repeat, inEditable }) {
  if (inEditable) {
    if (key === "ArrowUp" || key === "ArrowDown") return DIRECTIONS[key];
    if (key === "Escape" && !repeat) return "back";
    return null;
  }
  if (DIRECTIONS[key]) return DIRECTIONS[key];
  if (repeat) return null;
  if (key === "Enter") return "select";
  if (BACK_KEYS.has(key)) return "back";
  return null;
}
