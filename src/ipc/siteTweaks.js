const { clickFirstScript, sourceHosts, sourcePageCss, validateSource } = require("../shared/sources.js");

function prepareSourceRules(entry) {
  const { ok, source } = validateSource(entry);
  if (!ok) return null;
  const css = sourcePageCss(source);
  if (css && css.length > 20000) return null;
  return { hosts: sourceHosts(source), css, clickFirst: source.clickFirst };
}

const activeRules = new WeakMap();

async function clickFirst(wc) {
  const state = activeRules.get(wc);
  if (!state?.selector || state.clicked || wc.isDestroyed()) return;
  if (!state.clicking) {
    state.clicking = wc.executeJavaScript(clickFirstScript(state.selector), true)
      .then((clicked) => { state.clicked = clicked; }, () => {})
      .finally(() => { state.clicking = null; });
  }
  await state.clicking;
}

function apply(wc, rules) {
  activeRules.delete(wc);
  if (!rules || wc.isDestroyed()) return;
  let hostname;
  try { hostname = new URL(wc.getURL()).hostname; } catch { return; }
  if (!rules.hosts.some((host) => hostname === host || hostname.endsWith("." + host))) return;
  if (rules.css) wc.insertCSS(rules.css, { cssOrigin: "user" }).catch(() => {});
  if (rules.clickFirst) {
    activeRules.set(wc, { selector: rules.clickFirst });
    void clickFirst(wc);
  }
}

module.exports = { apply, clickFirst, prepareSourceRules };
