// Drag-to-scroll for touch screens streamed through the Docker image (a phone
// swipe arrives as a mouse drag). Dragging scrolls instead of selecting text
// or dragging images; a tap still clicks. Enabled by STREAMBERT_DRAG_SCROLL=1.

const THRESHOLD = 8;
const SKIP =
  'input, textarea, select, webview, [contenteditable="true"], [draggable="true"]';

export const isDragging = (dx, dy) => Math.hypot(dx, dy) >= THRESHOLD;

export function canScroll(el, axis, getStyle = getComputedStyle) {
  const s = getStyle(el);
  const over = axis === "y" ? s.overflowY : s.overflowX;
  if (over !== "auto" && over !== "scroll") return false;
  return axis === "y"
    ? el.scrollHeight > el.clientHeight
    : el.scrollWidth > el.clientWidth;
}

export const skipsDragScroll = (target) => !!target?.closest?.(SKIP);

function scrollerFor(el, axis) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n instanceof HTMLElement && canScroll(n, axis)) return n;
  }
  return axis === "y" ? document.scrollingElement : null;
}

export function enableDragScroll() {
  let start = null;
  let dragging = false;

  const swallowClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDown = (e) => {
    if (e.button !== 0 || skipsDragScroll(e.target)) return;
    start = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      sy: scrollerFor(e.target, "y"),
      sx: scrollerFor(e.target, "x"),
    };
    dragging = false;
  };
  const reset = () => {
    start = null;
    dragging = false;
  };
  const onMove = (e) => {
    if (!start) return;
    // Released outside the window (no pointerup seen): stop scrolling
    if (!(e.buttons & 1)) return reset();
    if (!dragging && !isDragging(e.clientX - start.x, e.clientY - start.y))
      return;
    dragging = true;
    if (start.sy) start.sy.scrollTop -= e.clientY - start.lastY;
    if (start.sx) start.sx.scrollLeft -= e.clientX - start.lastX;
    start.lastX = e.clientX;
    start.lastY = e.clientY;
    e.preventDefault();
  };
  const onUp = () => {
    // A drag must not end in a click on whatever is under the finger
    if (dragging) window.addEventListener("click", swallowClick, { capture: true, once: true });
    start = null;
    setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
  };
  const onDragStart = (e) => {
    if (!skipsDragScroll(e.target)) e.preventDefault();
  };

  document.body.classList.add("drag-scroll");
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", reset, true);
  window.addEventListener("dragstart", onDragStart, true);
  return () => {
    document.body.classList.remove("drag-scroll");
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", reset, true);
    window.removeEventListener("dragstart", onDragStart, true);
  };
}
