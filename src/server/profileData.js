const HOUSEHOLD_KEYS = ["playerSources", "invidiousBase", "downloadCleanupDays", "downloadSpaceLimitGb"];
const KIDS_LOCKED_KEYS = ["ageLimit", "ratingCountry"];
const HOUSEHOLD_ID = "household";

function splitChange(change) {
  const household = {};
  const profile = {};
  for (const [operation, values] of Object.entries(change)) {
    for (const [key, value] of operation === "remove" ? values.map((key) => [key, key]) : Object.entries(values)) {
      const target = HOUSEHOLD_KEYS.includes(key) ? household : profile;
      if (operation === "remove") (target.remove ??= []).push(key);
      else (target[operation] ??= {})[key] = value;
    }
  }
  return {
    profile: Object.keys(profile).length ? profile : null,
    household: Object.keys(household).length ? household : null,
  };
}

function changeError(change, profile) {
  const keys = [...Object.keys(change.set ?? {}), ...Object.keys(change.merge ?? {}), ...(change.remove ?? [])];
  if (!profile.main && keys.some((key) => HOUSEHOLD_KEYS.includes(key))) return "household";
  if (profile.kids && keys.some((key) => KIDS_LOCKED_KEYS.includes(key))) return "kidsLocked";
  return null;
}

function bootstrapStorage(profileData, householdData, profile) {
  const storage = { ...profileData };
  for (const key of HOUSEHOLD_KEYS) {
    if (Object.hasOwn(householdData, key)) storage[key] = householdData[key];
    else delete storage[key];
  }
  if (profile.kids) {
    storage.ageLimit = profile.ageLimit;
    storage.ratingCountry = profile.ratingCountry;
  }
  return storage;
}

function watchedDiff(change, before) {
  const watched = [];
  const unwatched = [];
  const merge = change.merge?.watched;
  const reset = change.remove?.includes("watched");
  const replace = Object.hasOwn(change.set ?? {}, "watched");
  if (!merge && !reset && !replace) return { watched, unwatched };

  const after = reset ? {} : { ...(replace ? change.set.watched : before), ...merge };
  for (const key of Object.keys(after)) {
    if (after[key] === true && before?.[key] !== true) watched.push(key);
  }
  for (const key of Object.keys(before ?? {})) {
    if (before[key] === true && after[key] !== true) unwatched.push(key);
  }
  return { watched, unwatched };
}

module.exports = { HOUSEHOLD_KEYS, KIDS_LOCKED_KEYS, HOUSEHOLD_ID, splitChange, changeError, bootstrapStorage, watchedDiff };
