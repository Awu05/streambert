export const currentProfile = () => globalThis.window?.electron?.profile ?? null;
export const isKidsProfile = () => currentProfile()?.kids === true;
export const isMainProfile = () => currentProfile()?.main === true;
export const canManageHousehold = () => !currentProfile() || isMainProfile();
export const HOUSEHOLD_KEYS = ["playerSources", "invidiousBase", "downloadCleanupDays", "downloadSpaceLimitGb"];
export const AGE_LIMIT_OPTIONS = ["", "0", "7", "12", "13", "15", "16", "17", "18"].map((value) => ({
  value, labelKey: value ? `settings.ageLimit.a${value}` : "settings.ageLimit.none",
}));

export function restorableKeys(keys) {
  return keys.filter((key) => (canManageHousehold() || !HOUSEHOLD_KEYS.includes(key)) &&
    (!isKidsProfile() || !["ageLimit", "ratingCountry"].includes(key)));
}
