const { clickFirstScript, sourceHosts, sourcePageCss, validateSource } = require("../shared/sources.js");

const CLICK_RETRY_MS = 500;
const CLICK_TRIES = 20;

function prepareSourceRules(entry) {
  const { ok, source } = validateSource(entry);
  if (!ok) return null;
  const css = sourcePageCss(source);
  if (css && css.length > 20000) return null;
  return { hosts: sourceHosts(source), css, clickFirst: source.clickFirst };
}

const states = new WeakMap();

function matches(wc, rules) {
  try {
    const { hostname } = new URL(wc.getURL());
    return rules.hosts.some((host) => hostname === host || hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

// Clicks the source's "click first" element once per page, if it's there yet.
async function clickFirst(wc) {
  const state = states.get(wc);
  const selector = state?.rules?.clickFirst;
  if (!selector || state.clicked || wc.isDestroyed() || !matches(wc, state.rules)) return;
  state.clicking ??= wc.executeJavaScript(clickFirstScript(selector), true)
    .then((clicked) => { state.clicked = clicked; }, () => {})
    .finally(() => { state.clicking = null; });
  await state.clicking;
}

// Pages often draw their server list after load, so keep trying for ~10 s.
function retryClickFirst(wc, state, page) {
  let tries = 0;
  const attempt = async () => {
    if (state.page !== page || wc.isDestroyed()) return;
    await clickFirst(wc);
    if (!state.clicked && ++tries < CLICK_TRIES) setTimeout(attempt, CLICK_RETRY_MS);
  };
  void attempt();
}

function apply(wc, state) {
  if (!state.rules || wc.isDestroyed() || state.applied === state.page || !matches(wc, state.rules)) return;
  state.applied = state.page;
  // "user" origin: !important beats the site's own !important rules
  if (state.rules.css) wc.insertCSS(state.rules.css, { cssOrigin: "user" }).catch(() => {});
  if (state.rules.clickFirst) retryClickFirst(wc, state, state.page);
}

// Sets a player's source rules. They apply as each page commits (before it
// draws, so hidden parts don't flash) and again at dom-ready as a fallback.
function setRules(wc, rules) {
  if (!wc || wc.isDestroyed()) return;
  let state = states.get(wc);
  if (!state) {
    state = { page: 0, applied: -1 };
    states.set(wc, state);
    wc.on("did-frame-navigate", (_e, _url, _code, _text, isMainFrame) => {
      if (!isMainFrame) return;
      state.page++;
      state.clicked = false;
      apply(wc, state);
    });
    wc.on("dom-ready", () => apply(wc, state));
  }
  const key = JSON.stringify(rules);
  if (state.key !== key) Object.assign(state, { key, rules, applied: -1, clicked: false });
  apply(wc, state);
}

module.exports = { clickFirst, prepareSourceRules, setRules };
