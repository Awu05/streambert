import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { getSources } from "../../utils/api";
import { storage, STORAGE_KEYS } from "../../utils/storage";
import { applyTestResult, moveSource, saveSources } from "../../utils/sourceList";
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

export default function SourcesSection({ Toggle, Select, ConfirmDialog, revision, readOnly }) {
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
  const [committing, setCommitting] = useState(false);
  const activeTest = useRef(null);

  useEffect(() => () => activeTest.current?.abort(), []);
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
    setTestedError(null);
    setMessage(null);
  }, [revision]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const locked = readOnly || running !== null || committing;
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

  async function test(entry) {
    if (activeTest.current) return;
    const validation = validateSource({ ...serialize(entry), id: entry.id || "draft-source" });
    if (!validation.ok) {
      showErrors(entry, validation.errors);
      return;
    }
    const controller = new AbortController();
    activeTest.current = controller;
    setRunning(entry.rowKey);
    setTestedError(null);
    setMessage(null);
    try {
      const result = await window.electron.testSource(validation.source, controller.signal, storage.get(STORAGE_KEYS.SUBTITLE_LANG));
      if (controller.signal.aborted) return;
      if (result.error) {
        if (result.errors?.length) showErrors(entry, result.errors);
        else setTestedError(entry.rowKey);
        return;
      }
      setDraft((rows) => rows.map((row) => row.rowKey === entry.rowKey ? applyTestResult(row, result, Date.now()) : row));
    } catch {
      if (!controller.signal.aborted) setTestedError(entry.rowKey);
    } finally {
      if (activeTest.current === controller) {
        activeTest.current = null;
        setRunning(null);
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
    void persist(result.list);
  }

  return (
    <section className="settings-section source-settings" aria-labelledby="source-settings-title">
      {readOnly && <p>{t("profiles.managed")}</p>}
      <div className="source-heading">
        <h2 className="settings-section-title" id="source-settings-title">{t("settings.tabs.sources")}</h2>
        <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => {
          add({
            id: "", label: label("newName"), enabled: true, idType: "tmdb", progress: "page",
            params: {}, hideCss: [], web: { movie: "untested", tv: "untested", anime: "untested", testedAt: null, reasons: {} },
          });
        }}>{label("add")}</button>
      </div>
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
            <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => test(entry)}>
              {label(running === entry.rowKey ? "testing" : "test")}
            </button>
            <button type="button" className="btn btn-ghost" aria-expanded={editing === entry.rowKey}
              onClick={() => setEditing(editing === entry.rowKey ? null : entry.rowKey)}>
              {label(editing === entry.rowKey ? "close" : "edit")}
            </button>
          </div>
        </div>
        {running === entry.rowKey && <p className="source-status" role="status">{label("testingStatus")}</p>}
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
