export function hasCapability(name) {
  const capabilities = globalThis.window?.electron?.capabilities;
  return !capabilities || capabilities[name] === true;
}

export const isWebBuild = () => globalThis.window?.electron?.isWeb === true;
export const isSourceAvailableInBrowser = (source, kind) =>
  globalThis.window?.electron?.browserSources?.[source]?.includes(kind) === true;
