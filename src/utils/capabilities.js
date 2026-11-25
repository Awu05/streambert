export function hasCapability(name) {
  const capabilities = globalThis.window?.electron?.capabilities;
  return !capabilities || capabilities[name] === true;
}

export const isWebBuild = () => globalThis.window?.electron?.isWeb === true;
export const isSourceAvailableInBrowser = (source, kind) =>
  Object.hasOwn(globalThis.window?.electron?.sourceModes || {}, source) &&
  window.electron.sourceModes[source][kind] === "detached";
