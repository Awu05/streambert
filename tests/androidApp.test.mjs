import { test } from "node:test";
import assert from "node:assert/strict";
import { androidBackAction, androidRequest, installAndroidBack, isAndroidApp } from "../src/web/androidApp.js";

test("Android Back gives overlays priority over the player and navigation", () => {
  assert.equal(androidBackAction({ playerOpen: true, overlayOpen: true, navDepth: 3 }), "overlay");
  assert.equal(androidBackAction({ playerOpen: true, overlayOpen: false, navDepth: 3 }), "player");
  assert.equal(androidBackAction({ playerOpen: false, overlayOpen: false, navDepth: 1 }), "nav");
  assert.equal(androidBackAction({ playerOpen: false, overlayOpen: false, navDepth: 0 }), null);
});

test("Fullscreen Back closes an open player menu, then leaves fullscreen to Android", (t) => {
  const events = [];
  let panel = {
    contains: () => false,
    dispatchEvent: ({ key }) => {
      events.push(key);
      panel = null;
    },
  };
  const player = { querySelector: () => panel, dispatchEvent: () => assert.fail("Player closed") };
  globalThis.window = {};
  globalThis.document = {
    querySelector: () => player,
    querySelectorAll: () => [],
    activeElement: null,
  };
  globalThis.KeyboardEvent = class {
    constructor(_type, { key }) { this.key = key; }
  };
  const uninstall = installAndroidBack({
    getNavDepth: () => 2,
    navigateBack: () => assert.fail("Navigated from fullscreen"),
  });
  t.after(() => {
    uninstall();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.KeyboardEvent;
  });

  assert.equal(window.streambertAndroidBack.dismissOverlay(), true);
  assert.deepEqual(events, ["Escape"]);
  assert.equal(window.streambertAndroidBack.dismissOverlay(), false);
});

test("Android detection and concurrent bridge replies", async (t) => {
  t.after(() => delete globalThis.window);
  globalThis.window = {};
  assert.equal(isAndroidApp(), false);
  await assert.rejects(androidRequest("getInfo"), /unavailable/);

  const sent = [];
  const bridge = { postMessage: (value) => sent.push(JSON.parse(value)) };
  globalThis.window.StreambertAndroid = bridge;
  assert.equal(isAndroidApp(), true);

  const info = androidRequest("getInfo");
  const status = androidRequest("checkUpdates");
  assert.deepEqual(sent.map(({ type }) => type), ["getInfo", "checkUpdates"]);
  bridge.onmessage({ data: "invalid JSON" });
  bridge.onmessage({ data: JSON.stringify({ id: sent[1].id, status: "none" }) });
  bridge.onmessage({ data: JSON.stringify({ id: sent[0].id, version: "2.16.0" }) });
  assert.equal((await status).status, "none");
  assert.equal((await info).version, "2.16.0");
});
