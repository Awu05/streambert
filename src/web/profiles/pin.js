export function nextPin(current, key) {
  if (key === "back") return current.slice(0, -1);
  return /^\d$/.test(key) && current.length < 4 ? current + key : current;
}
