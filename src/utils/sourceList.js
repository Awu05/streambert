import { DEFAULT_SOURCES, sourceIdFromLabel, sourceKinds, validateSource } from "../shared/sources";

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
  const web = { ...source.web, testedAt };
  const lastReasons = {};
  for (const kind of sourceKinds(source)) {
    const entry = result[kind];
    if (!entry) continue;
    web[kind] = entry.status;
    if (entry.reason) lastReasons[kind] = entry.reason;
  }
  return { ...source, web, lastReasons };
}
