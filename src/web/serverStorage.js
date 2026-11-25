const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (object, key) => Object.hasOwn(object, key);
const perEntry = new Set(["saved", "progress", "watched", "sourceFailoverCache"]);

function apply(data, change) {
  Object.assign(data, change.set);
  for (const [key, entries] of Object.entries(change.merge || {})) {
    const previous = has(data, key) ? data[key] : null;
    const next = Object.assign(Object.create(null), isRecord(previous) ? previous : {});
    for (const [entry, value] of Object.entries(entries)) {
      if (value === null) delete next[entry];
      else next[entry] = value;
    }
    data[key] = next;
  }
  for (const key of change.remove || []) delete data[key];
}

export function createServerStorage({ initial, fixed = {}, post, batchMs = 200, retryMs = 2000 }) {
  let data = Object.assign(Object.create(null), structuredClone(initial));
  let pending = [];
  let sending = [];
  let timer;
  let failures = 0;

  const schedule = (ms = batchMs) => {
    if (!timer && !sending.length) {
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, ms);
    }
  };
  function queue(change) {
    apply(data, change);
    pending.push(change);
    schedule();
  }
  function combine(changes) {
    const byKey = new Map();
    for (const change of changes) {
      for (const [key, value] of Object.entries(change.set || {})) byKey.set(key, ["set", value]);
      for (const [key, entries] of Object.entries(change.merge || {})) {
        const previous = byKey.get(key);
        if (previous && previous[0] !== "merge") {
          const isolated = Object.assign(Object.create(null), { [key]: previous[1] });
          apply(isolated, { merge: { [key]: entries } });
          byKey.set(key, ["set", isolated[key]]);
        } else byKey.set(key, ["merge", { ...previous?.[1], ...entries }]);
      }
      for (const key of change.remove || []) byKey.set(key, ["remove"]);
    }
    const result = {};
    for (const [key, [action, value]] of byKey) {
      if (action === "remove") (result.remove ||= []).push(key);
      else (result[action] ||= Object.create(null))[key] = value;
    }
    return result;
  }
  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (sending.length || !pending.length) return;
    sending = pending;
    pending = [];
    try {
      await post(combine(sending));
      failures = 0;
    } catch (error) {
      pending.unshift(...sending);
      failures++;
      if (failures === 5) console.warn("Could not sync changes to Streambert:", error.message);
    } finally {
      sending = [];
      if (pending.length && failures < 5) schedule(failures ? retryMs : batchMs);
    }
  }

  return {
    get(key) {
      const value = has(fixed, key) ? fixed[key] : (has(data, key) ? data[key] : null);
      return structuredClone(value);
    },
    set(key, value) {
      if (has(fixed, key) || value === undefined) return;
      const before = data[key] ?? (perEntry.has(key) ? {} : null);
      if (same(before, value)) return;
      const next = structuredClone(value);
      if (isRecord(before) && isRecord(next)) {
        const entries = Object.create(null);
        for (const entry of new Set([...Object.keys(before), ...Object.keys(next)])) {
          if (!has(next, entry)) entries[entry] = null;
          else if (!same(before[entry], next[entry])) entries[entry] = next[entry];
        }
        if (Object.keys(entries).length) queue({ merge: { [key]: entries } });
      } else queue({ set: { [key]: next } });
    },
    remove(key) {
      if (!has(fixed, key)) queue({ remove: [key] });
    },
    clearAll() {
      queue({ remove: Object.keys(data).filter((key) => !has(fixed, key)) });
    },
    applyRemote(change) {
      apply(data, change);
      for (const queued of [...sending, ...pending]) apply(data, queued);
      return [...new Set([...Object.keys(change.set || {}), ...Object.keys(change.merge || {}), ...(change.remove || [])])];
    },
    replace(snapshot) {
      const previous = Object.keys(data);
      data = Object.assign(Object.create(null), structuredClone(snapshot));
      for (const queued of [...sending, ...pending]) apply(data, queued);
      return [...new Set([...previous, ...Object.keys(data)])];
    },
    flush,
  };
}
