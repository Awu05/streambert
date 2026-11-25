const UNKNOWN = /^(?:|und|unknown|xx)$/i;

// A language code usable as <track srclang>: "und" when the language is unknown.
export const trackLanguage = (code) => (UNKNOWN.test(String(code || "").trim()) ? "und" : String(code).trim());

// A readable subtitle name: "en" → "English"; unknown languages → `fallback`.
export function languageLabel(code, fallback = "Subtitles", locale = globalThis.navigator?.language || "en") {
  const value = trackLanguage(code);
  if (value === "und") return fallback;
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(value) || value;
  } catch {
    return value.toUpperCase();
  }
}
