import { apiRequest } from "../bridge";

export const PROFILE_SWITCH_KEY = "streambert:profile-session";

export function notifyProfileSwitch() {
  try { localStorage.setItem(PROFILE_SWITCH_KEY, String(Date.now())); } catch {}
}

export const listProfiles = () => apiRequest("/api/profiles");
export const managedProfiles = (pin) => apiRequest("/api/profiles/manage", { pin });
export const createProfile = (data, pin) => apiRequest("/api/profiles", { ...data, pin });
export const updateProfile = (id, data, pin) => apiRequest(`/api/profiles/${id}`, { ...data, pin }, { method: "PATCH" });
export const deleteProfile = (id, pin) => apiRequest(`/api/profiles/${id}`, { pin }, { method: "DELETE" });
export const selectProfile = (id, pin) => apiRequest("/api/profiles/select", { id, pin });
export const leaveProfile = () => apiRequest("/api/profiles/leave", {});
export const setMyPin = (current, pin) => apiRequest("/api/profiles/me/pin", { current, pin });

export function profileError(t, error) {
  if (error.code === "locked") return t("profiles.locked", { minutes: Math.ceil(error.retryAfter / 60) });
  return t(`profiles.errors.${error.code}`, { defaultValue: t("profiles.errors.requestFailed") });
}

export async function signOut() {
  await window.electron?.flushStorage?.();
  await apiRequest("/api/logout", {});
  notifyProfileSwitch();
  location.replace("/login");
}
