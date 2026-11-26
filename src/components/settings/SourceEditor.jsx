import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function SourceEditor({ value, update, errors, remove, focusName, Select }) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const label = (field) => t("settings.sources.field." + field);
  const errorFor = (field) => errors.filter((error) => error.field === field);
  const hint = (field) => errorFor(field).map((error, index) => (
    <small className="source-error" role="alert" key={index}>{t("settings.sources.error." + error.message)}</small>
  ));
  const text = (field, help) => (
    <label className="source-field">
      <span>{label(field)}</span>
      <input value={value[field] ?? ""} aria-invalid={errorFor(field).length > 0}
        autoFocus={field === "label" && focusName}
        onChange={(event) => update({ [field]: event.target.value })} spellCheck={false} />
      {help && <small>{t("settings.sources.help." + field)}</small>}
      {hint(field)}
    </label>
  );
  const choose = (field, options) => (
    <div className="source-field">
      <span>{label(field)}</span>
      <Select value={value[field]} label={label(field)} invalid={errorFor(field).length > 0}
        onChange={(selection) => update({ [field]: selection })}
        options={options.map((option) => ({ value: option, label: label(option) }))} />
      {hint(field)}
    </div>
  );
  const toggle = (field) => (
    <label className="source-checkbox">
      <input type="checkbox" checked={!!value[field]} onChange={(event) => update({ [field]: event.target.checked })} />
      {label(field)}
    </label>
  );
  const changeParam = (index, patch) => update({
    paramRows: value.paramRows.map((row, i) => i === index ? { ...row, ...patch } : row),
  });
  const showAdvanced = advanced || errors.some(({ field }) =>
    ["animeUrl", "hideCss", "onlyElement", "colorParam", "langParam", "progress"].includes(field));
  return (
    <div className="source-editor">
      {text("label")}
      {!value.resolver && <>
        {text("movieUrl", true)}
        {text("tvUrl", true)}
        {choose("idType", ["tmdb", "imdb", "kinopoisk"])}
        <fieldset className="source-params">
          <legend>{label("params")}</legend>
          {value.paramRows.map(({ key, content }, index) => (
            <div className="source-param-row" key={index}>
              <input aria-label={label("paramKey")} placeholder={label("paramKey")} value={key}
                onChange={(event) => changeParam(index, { key: event.target.value })} />
              <input aria-label={label("paramValue")} placeholder={label("paramValue")} value={content}
                onChange={(event) => changeParam(index, { content: event.target.value })} />
              <button type="button" className="btn btn-ghost" aria-label={label("removeParam")}
                onClick={() => update({ paramRows: value.paramRows.filter((_, i) => i !== index) })}>×</button>
            </div>
          ))}
          {hint("params")}
          <button type="button" className="btn btn-secondary" onClick={() => update({
            paramRows: [...value.paramRows, { key: "", content: "" }],
          })}>{label("addParam")}</button>
        </fieldset>
        {toggle("cleanUserAgent")}
        {text("clickFirst")}
        <button type="button" className="btn btn-secondary source-advanced" aria-expanded={showAdvanced}
          onClick={() => setAdvanced(!showAdvanced)}>{t("settings.sources.advanced")}</button>
        {showAdvanced && <>
          {text("animeUrl", true)}
          {text("colorParam")}
          {toggle("colorWithHash")}
          {text("langParam")}
          {choose("progress", ["none", "page", "frames"])}
          {toggle("skipResetGuard")}
          {toggle("interceptFullscreen")}
          <label className="source-field">
            <span>{label("hideCss")}</span>
            <textarea rows={3} value={value.hideCss.join("\n")} aria-invalid={errorFor("hideCss").length > 0}
              onChange={(event) => update({ hideCss: event.target.value.split("\n") })} />
            <small>{t("settings.sources.help.hideCss")}</small>
            {hint("hideCss")}
          </label>
          {text("onlyElement")}
        </>}
      </>}
      <button type="button" className="btn btn-ghost source-delete" onClick={remove}>{t("settings.sources.delete")}</button>
    </div>
  );
}
