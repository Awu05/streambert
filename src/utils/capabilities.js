import { findSource } from "./api";
import { sourceKinds } from "../shared/sources";

export function hasCapability(name) {
  const capabilities = globalThis.window?.electron?.capabilities;
  return !capabilities || capabilities[name] === true;
}

export const isWebBuild = () => globalThis.window?.electron?.isWeb === true;
export function isSourceAvailableInBrowser(id, kind) {
  const source = findSource(id);
  return Boolean(source?.enabled && sourceKinds(source).includes(kind));
}
