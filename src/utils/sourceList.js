import { DEFAULT_SOURCES, loadingFieldsEqual, sourceIdFromLabel, sourceKinds, validateSource } from "../shared/sources";

export function moveSource(list, index, delta) {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  if (to === index || index < 0 || index >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(index, 1)[0]);
  return next;
}

export function saveSources(draft) {
  const list = [];
  const errors = [];
  const seen = new Set();
  const reserved = new Set([...DEFAULT_SOURCES, ...draft].map(({ id }) => id));
  draft.forEach((entry, index) => {
    const label = typeof entry.label === "string" ? entry.label : "";
    const id = entry.id === "" ? sourceIdFromLabel(label, reserved) : entry.id;
    const result = validateSource({ ...entry, id });
    if (!result.ok) errors.push(...result.errors.map((error) => ({ ...error, index })));
    if (seen.has(id)) errors.push({ index, field: "label", message: "duplicateId" });
    seen.add(id);
    reserved.add(id);
    if (result.ok) list.push(result.source);
  });
  return errors.length ? { ok: false, errors } : { ok: true, list };
}

export function applyTestResult(source, result, testedAt) {
  const web = { ...source.web, testedAt, reasons: { ...source.web.reasons } };
  for (const kind of sourceKinds(source)) {
    const entry = result[kind];
    if (!entry) continue;
    web[kind] = entry.status;
    if (entry.status === "failed" && typeof entry.reason === "string" && entry.reason.length <= 100) {
      web.reasons[kind] = entry.reason;
    } else {
      delete web.reasons[kind];
    }
  }
  return { ...source, web };
}

export function storeTestResult(stored, tested) {
  const index = stored.findIndex(({ id }) => id === tested.id);
  if (index < 0 || !loadingFieldsEqual(stored[index], tested)) return null;
  return stored.map((source, i) => i === index ? { ...source, web: tested.web } : source);
}

export function mergeSavedResults(list, stored) {
  const byId = new Map(stored.map((source) => [source.id, source]));
  return list.map((source) => {
    const current = byId.get(source.id);
    return current && loadingFieldsEqual(source, current) &&
      (current.web.testedAt ?? -Infinity) > (source.web.testedAt ?? -Infinity)
      ? { ...source, web: current.web }
      : source;
  });
}

export function rowHasLoadingEdits(row, stored) {
  const current = stored.find(({ id }) => id === row.id);
  return !current || !loadingFieldsEqual(row, current);
}

export function testAllSummary(results) {
  const works = results.filter(({ result }) =>
    !result.error && Object.values(result).some((kind) => kind?.status === "works")).length;
  return { tested: results.length, works, failed: results.length - works };
}

const EXPORT_FORMAT = { app: "streambert", type: "sources", version: 1 };

// A shareable file: addresses and settings, without this server's test results.
export function exportSources(list) {
  return {
    ...EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    sources: list.map(({ web, ...source }) => source),
  };
}

// The valid sources in an export file, or why it can't be imported.
export function parseSourceImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: "notJson" }; }
  if (data?.app !== EXPORT_FORMAT.app || data.type !== EXPORT_FORMAT.type || !Array.isArray(data.sources)) {
    return { ok: false, error: "notSources" };
  }
  if (data.version > EXPORT_FORMAT.version) return { ok: false, error: "newerVersion" };
  const sources = [];
  const seen = new Set();
  let invalid = 0;
  for (const entry of data.sources) {
    const result = validateSource({ ...entry, web: undefined });
    if (!result.ok || seen.has(result.source.id)) invalid++;
    else {
      seen.add(result.source.id);
      sources.push(result.source);
    }
  }
  return sources.length ? { ok: true, sources, invalid } : { ok: false, error: "empty", invalid };
}

// "merge" adds new sources and updates existing ones (by id); "replace" uses the file's list.
// An updated source keeps its test results when it still loads the same addresses.
export function importSources(current, imported, mode) {
  const byId = new Map(current.map((source) => [source.id, source]));
  const incoming = imported.map((source) => {
    const existing = byId.get(source.id);
    return existing && loadingFieldsEqual(existing, source) ? { ...source, web: existing.web } : source;
  });
  if (mode === "replace") return incoming;
  const updates = new Map(incoming.map((source) => [source.id, source]));
  return [
    ...current.map((source) => updates.get(source.id) ?? source),
    ...incoming.filter((source) => !byId.has(source.id)),
  ];
}

export function importSummary(current, imported) {
  const ids = new Set(current.map(({ id }) => id));
  const updated = imported.filter(({ id }) => ids.has(id)).length;
  return { added: imported.length - updated, updated };
}
