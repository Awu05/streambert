import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getSources } from "../../utils/api";
import { storage, STORAGE_KEYS } from "../../utils/storage";
import {
  applyTestResult, mergeSavedResults, moveSource, rowHasLoadingEdits, saveSources, storeTestResult, testAllSummary,
} from "../../utils/sourceList";
import { newDefaultSources, resetStatusOnEdit, sourceKinds, validateSource } from "../../shared/sources";
import SourceEditor from "./SourceEditor";

function draftEntry(source, rowKey) {
  return {
    ...source, rowKey,
    paramRows: Object.entries(source.params).map(([key, content]) => ({ key, content })),
  };
}

function serialize(entry) {
  const keys = entry.paramRows.map(({ key }) => key.trim());
  const params = Object.fromEntries(entry.paramRows.map(({ content }, index) => [keys[index], content]));
  return {
    ...entry,
    params: new Set(keys).size === keys.length ? params : null,
    hideCss: entry.hideCss.map((value) => value.trim()).filter(Boolean),
  };
}

function SourceStatus({ entry }) {
  const { t } = useTranslation();
  const kinds = sourceKinds(entry);
  if (!kinds.length || kinds.every((kind) => entry.web[kind] === "untested")) {
    return <span className="source-status">{t("player.sourceStatus.untested")}</span>;
  }
  return <span className="source-status">
    {kinds.map((kind) => {
      const reason = entry.web.reasons?.[kind];
      const refusal = reason?.match(/^stream refused replay \((.+)\)$/);
      const detail = refusal
        ? t("settings.sources.reason.refused", {
          status: refusal[1] === "network error" ? t("settings.sources.reason.networkError") : refusal[1],
        })
        : reason && t("settings.sources.reason." + reason, { defaultValue: reason });
      return <span key={kind}>{t("settings.sources.kind." + kind)} · {detail || t("player.sourceStatus." + entry.web[kind])}</span>;
    })}
  </span>;
}

export default function SourcesSection({ Toggle, Select, ConfirmDialog, revision, readOnly, visible }) {
  const { t } = useTranslation();
  const label = (key, values) => t("settings.sources." + key, values);
  const rowNumber = useRef(0);
  const makeRow = (source) => draftEntry(source, ++rowNumber.current);
  const [draft, setDraft] = useState(() => getSources().map(makeRow));
  const [baseline, setBaseline] = useState(draft);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState([]);
  const [testedError, setTestedError] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [running, setRunning] = useState(null);
  const [batch, setBatch] = useState(null);
  const [summary, setSummary] = useState(null);
  const [committing, setCommitting] = useState(false);
  const activeTest = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeTest.current?.abort();
      activeTest.current = null;
    };
  }, []);
  useEffect(() => {
    if (!visible || readOnly) activeTest.current?.abort();
  }, [visible, readOnly]);
  useEffect(() => {
    if (!revision) return;
    activeTest.current?.abort();
    activeTest.current = null;
    const next = getSources().map(makeRow);
    setDraft(next);
    setBaseline(next);
    setEditing(null);
    setErrors([]);
    setRunning(null);
    setBatch(null);
    setSummary(null);
    setTestedError(null);
    setMessage(null);
  }, [revision]);

  useEffect(() => {
    function syncResults(event) {
      if (!event.detail?.keys?.includes(STORAGE_KEYS.PLAYER_SOURCES)) return;
      const stored = getSources();
      const results = new Map(draft.flatMap((row) => rowHasLoadingEdits(serialize(row), stored)
        ? []
        : [[row.rowKey, stored.find(({ id }) => id === row.id).web]]));
      const refresh = (rows) => rows.map((row) => results.has(row.rowKey) && !rowHasLoadingEdits(serialize(row), stored)
        ? { ...row, web: results.get(row.rowKey) }
        : row);
      setDraft(refresh);
      setBaseline(refresh);
    }
    window.addEventListener("streambert:storage-changed", syncResults);
    return () => window.removeEventListener("streambert:storage-changed", syncResults);
  }, [draft]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const locked = readOnly || running !== null || batch !== null || committing;
  const additions = newDefaultSources(getSources()).filter(({ id }) => !draft.some((entry) => entry.id === id));

  function add(source) {
    const row = makeRow(source);
    setDraft([...draft, row]);
    setEditing(row.rowKey);
    setMessage(null);
  }

  function update(entry, changes) {
    const next = { ...entry, ...changes };
    const before = serialize(entry);
    const after = serialize(next);
    next.web = resetStatusOnEdit(before, after).web;
    setDraft(draft.map((row) => row.rowKey === entry.rowKey ? next : row));
    setErrors(errors.filter(({ rowKey, field }) => rowKey !== entry.rowKey || !(field in changes || field === "params")));
    setMessage(null);
  }

  function showErrors(row, issues) {
    setErrors(issues.map((error) => ({ ...error, rowKey: row.rowKey })));
    setEditing(row.rowKey);
  }

  async function runTest(entry, controller) {
    const canUpdate = () => mounted.current && activeTest.current === controller;
    const validation = validateSource({ ...serialize(entry), id: entry.id || "draft-source" });
    if (!validation.ok) {
      showErrors(entry, validation.errors);
      return { error: true };
    }
    const requestId = window.electron.cancelSourceTest ? crypto.randomUUID() : undefined;
    const { signal } = controller;
    const cancel = () => window.electron.cancelSourceTest(requestId);
    if (requestId) signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await window.electron.testSource(
        validation.source, requestId ? undefined : signal, storage.get(STORAGE_KEYS.SUBTITLE_LANG), requestId,
      );
      if (!canUpdate() || signal.aborted) return null;
      if (result.error) {
        if (result.errors?.length) showErrors(entry, result.errors);
        else setTestedError(entry.rowKey);
        return result;
      }
      const tested = applyTestResult(validation.source, result, Date.now());
      const list = storeTestResult(getSources(), { ...tested, id: entry.id });
      const refresh = (rows) => rows.map((row) => row.rowKey === entry.rowKey ? { ...row, web: tested.web } : row);
      setDraft(refresh);
      if (list) {
        storage.set(STORAGE_KEYS.PLAYER_SOURCES, list);
        try {
          if (await storage.flush() === false) throw new Error("Source storage did not sync");
          if (canUpdate()) {
            const stored = getSources();
            const current = stored.find(({ id }) => id === entry.id);
            if (current) {
              setBaseline((rows) => rows.map((row) => row.rowKey === entry.rowKey && !rowHasLoadingEdits(serialize(row), stored)
                ? { ...row, web: current.web }
                : row));
            }
          }
        } catch {
          if (canUpdate()) setMessage("saveError");
        }
      }
      return result;
    } catch {
      if (!canUpdate() || signal.aborted) return null;
      setTestedError(entry.rowKey);
      return { error: true };
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async function testRows(rows, all = false) {
    if (locked || activeTest.current || !rows.length) return;
    const controller = new AbortController();
    activeTest.current = controller;
    setTestedError(null);
    setMessage(null);
    setSummary(null);
    const results = [];
    try {
      for (const [index, row] of rows.entries()) {
        if (controller.signal.aborted) break;
        setRunning(row.rowKey);
        if (all) setBatch({ current: index + 1, total: rows.length, name: row.label });
        const result = await runTest(row, controller);
        if (result) results.push({ id: row.id, result });
      }
    } finally {
      if (mounted.current && activeTest.current === controller) {
        activeTest.current = null;
        setRunning(null);
        setBatch(null);
        if (all) setSummary(testAllSummary(results));
      }
    }
  }

  async function persist(list) {
    setCommitting(true);
    setMessage(null);
    setErrors([]);
    try {
      if (list === null) storage.remove(STORAGE_KEYS.PLAYER_SOURCES);
      else storage.set(STORAGE_KEYS.PLAYER_SOURCES, list);
      if (await storage.flush() === false) throw new Error("Source storage did not sync");
      const next = getSources().map(makeRow);
      setBaseline(next);
      setDraft(next);
      setEditing(null);
      setTestedError(null);
      setMessage("saved");
    } catch {
      setMessage("saveError");
    } finally {
      setCommitting(false);
    }
  }

  function save() {
    const result = saveSources(draft.map(serialize));
    if (!result.ok) {
      setErrors(result.errors.map((error) => ({ ...error, rowKey: draft[error.index].rowKey })));
      setEditing(draft[result.errors[0].index].rowKey);
      return;
    }
    void persist(mergeSavedResults(result.list, getSources()));
  }

  return (
    <section className="settings-section source-settings" aria-labelledby="source-settings-title">
      {readOnly && <p>{t("profiles.managed")}</p>}
      <div className="source-heading">
        <h2 className="settings-section-title" id="source-settings-title">{t("settings.tabs.sources")}</h2>
        <div className="source-actions source-test-actions">
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => {
            add({
              id: "", label: label("newName"), enabled: true, idType: "tmdb", progress: "page",
              params: {}, hideCss: [], web: { movie: "untested", tv: "untested", anime: "untested", testedAt: null, reasons: {} },
            });
          }}>{label("add")}</button>
          {!readOnly && <button type="button" className="btn btn-secondary" disabled={batch === null && locked}
            onClick={() => batch ? activeTest.current?.abort() : void testRows(draft, true)}>
            {label(batch ? "stop" : "testAll")}
          </button>}
        </div>
      </div>
      {(batch || summary) && <p className="source-status" role="status">
        {batch ? label("testingAll", batch) : label("testAllDone", summary)}
      </p>}
      {additions.map((source) => <div className="source-heading source-addition" key={source.id}>
        <span>{label("newBuiltIn", { source: source.label })}</span>
        <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => add(source)}>{label("addBuiltIn")}</button>
      </div>)}

      {draft.map((entry, index) => <div className="source-row" key={entry.rowKey}>
        <div className="source-row-controls">
          <Toggle value={entry.enabled} disabled={locked} title={label("enable", { source: entry.label })}
            onChange={(enabled) => update(entry, { enabled })} />
          <div className="source-move">
            {[-1, 1].map((step) => <button type="button" className="btn btn-ghost" key={step}
              aria-label={label(step < 0 ? "moveUp" : "moveDown")}
              disabled={locked || index + step < 0 || index + step >= draft.length}
              onClick={() => setDraft(moveSource(draft, index, step))}>{step < 0 ? "↑" : "↓"}</button>)}
          </div>
          <div className="source-description">
            <strong>{entry.label || label("newName")}</strong>
            <SourceStatus entry={entry} />
          </div>
          <div className="source-actions">
            <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => void testRows([entry])}>
              {label(running === entry.rowKey ? "testing" : "test")}
            </button>
            <button type="button" className="btn btn-ghost" aria-expanded={editing === entry.rowKey}
              disabled={batch !== null}
              onClick={() => setEditing(editing === entry.rowKey ? null : entry.rowKey)}>
              {label(editing === entry.rowKey ? "close" : "edit")}
            </button>
          </div>
        </div>
        {!batch && running === entry.rowKey && <p className="source-status" role="status">{label("testingStatus")}</p>}
        {testedError === entry.rowKey && <p className="source-error" role="alert">{label("testError")}</p>}
        {editing === entry.rowKey && <fieldset className="source-editor-fields" disabled={locked}>
          <SourceEditor Select={Select} Toggle={Toggle} value={entry} update={(changes) => update(entry, changes)}
            errors={errors.filter(({ rowKey }) => rowKey === entry.rowKey)}
            focusName={!entry.id} remove={() => setConfirm(entry.rowKey)} />
        </fieldset>}
      </div>)}

      <div className="source-heading source-footer">
        <button type="button" className="btn btn-ghost" disabled={locked} onClick={() => setConfirm("defaults")}>{label("reset")}</button>
        <div className="source-actions">
          {message && <span role="status">{label(message)}</span>}
          <button type="button" className="btn btn-primary" disabled={locked || !dirty} onClick={save}>{label("save")}</button>
        </div>
      </div>
      {confirm !== null && createPortal(<ConfirmDialog irreversible={confirm === "defaults"} title={label(confirm === "defaults" ? "reset" : "delete")}
        description={label(confirm === "defaults" ? "confirmReset" : "confirmDelete")}
        confirmLabel={label(confirm === "defaults" ? "reset" : "delete")} onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          if (confirm === "defaults") void persist(null);
          else {
            setDraft(draft.filter(({ rowKey }) => rowKey !== confirm));
            setEditing(null);
          }
        }} />, document.body)}
    </section>
  );
}
