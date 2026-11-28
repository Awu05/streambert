import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPlayerKey } from "../src/web/playerKeys.js";

const press = (key, lastDownAt, now, options) => mapPlayerKey({ key, repeat: false }, { lastDownAt, now }, options);

test("Down twice exits by default", () => {
  assert.deepEqual(press("ArrowDown", null, 1000), { action: "hintExit", lastDownAt: 1000 });
  assert.deepEqual(press("ArrowDown", 1000, 2500), { action: "exit", lastDownAt: null });
});

test("in the Android app Down only shows controls", () => {
  assert.deepEqual(press("ArrowDown", null, 1000, { downExits: false }), { action: "showControls", lastDownAt: null });
  assert.deepEqual(press("ArrowDown", 1000, 1500, { downExits: false }), { action: "showControls", lastDownAt: 1000 });
});

test("Back keys still exit in the app", () => {
  for (const key of ["Escape", "GoBack", "BrowserBack", "Backspace"]) {
    assert.equal(press(key, null, 0, { downExits: false }).action, "exit", key);
  }
});
