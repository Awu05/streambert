import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RATING_COUNTRIES } from "../../utils/ageRating";
import { AGE_LIMIT_OPTIONS } from "../../utils/profile";
import PinPad from "./PinPad";
import ProfileAvatar from "./ProfileAvatar";
import ProfileDialog from "./ProfileDialog";
import { createProfile, deleteProfile, managedProfiles, profileError, updateProfile } from "./profilesApi";

const COLORS = ["#e50914", "#f5a623", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e84393", "#7f8c8d"];
const newProfile = { name: "", color: COLORS[0], kids: false, ageLimit: "7", ratingCountry: "" };

export default function ManageProfiles({ main, onClose }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState(undefined);
  const [profiles, setProfiles] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load(value) {
    setError(null);
    try {
      setProfiles(await managedProfiles(value));
      setPin(value);
    } catch (problem) { setError(problem); }
  }
  useEffect(() => {
    if (!main?.hasPin) void load();
  }, [main?.hasPin]);

  async function mutate(operation) {
    setBusy(true);
    setError(null);
    try {
      await operation();
      setDraft(null);
      await load(pin);
    } catch (problem) {
      setError(problem);
      if (["wrongPin", "locked", "profileChanged"].includes(problem.code)) setProfiles(null);
    } finally {
      setBusy(false);
    }
  }
  const edit = (fields) => setDraft((current) => ({ ...current, ...fields }));
  const save = (event) => {
    event.preventDefault();
    const { id, name, color, kids, ageLimit, ratingCountry } = draft;
    const data = { name, color, kids, ageLimit, ratingCountry: ratingCountry || null };
    void mutate(() => id ? updateProfile(id, data, pin) : createProfile(data, pin));
  };

  return <ProfileDialog label={t("profiles.manage")} onClose={onClose}>
    {!profiles && (main?.hasPin || ["wrongPin", "locked", "profileChanged"].includes(error?.code))
      ? <PinPad title={t("profiles.enterMainPin")} onComplete={load} onCancel={onClose} error={error && profileError(t, error)} />
      : <>
        <h2>{t("profiles.manage")}</h2>
        {!profiles && !error && <div className="spinner" role="status" aria-label={t("profiles.loading")} />}
        {error && <p className="profile-error" role="alert">{profileError(t, error)}</p>}
        {draft ? <form className="profile-form" onSubmit={save}>
          <label>{t("profiles.name")}<input autoFocus className="apikey-input" value={draft.name}
            onChange={(event) => edit({ name: event.target.value })} maxLength={40} required /></label>
          <fieldset className="profile-colors">
            <legend>{t("profiles.color")}</legend>
            {COLORS.map((color, index) => <button type="button" key={color}
              aria-pressed={draft.color === color} aria-label={t("profiles.colorOption", { n: index + 1 })}
              style={{ "--profile-color": color }} onClick={() => edit({ color })} />)}
          </fieldset>
          {!draft.main && <label className="profile-check"><input type="checkbox" checked={draft.kids}
            onChange={(event) => edit({ kids: event.target.checked, ageLimit: draft.ageLimit ?? "7" })} />{t("profiles.kids")}</label>}
          {draft.kids && <>
            <label>{t("settings.content.maxAge")}<select value={draft.ageLimit} onChange={(event) => edit({ ageLimit: event.target.value })}>
              {AGE_LIMIT_OPTIONS.filter(({ value }) => value).map(({ value, labelKey }) => <option key={value} value={value}>{t(labelKey)}</option>)}
            </select></label>
            <label>{t("settings.content.ratingCountry")}<select value={draft.ratingCountry ?? ""} onChange={(event) => edit({ ratingCountry: event.target.value })}>
              <option value="">{t("profiles.mainCountry")}</option>
              {RATING_COUNTRIES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
            </select></label>
          </>}
          <div className="profile-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{t("settings.common.save")}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)} data-gamepad-close>{t("profiles.cancel")}</button>
          </div>
        </form> : <>
          <div className="profile-manage-list">
            {profiles?.map((profile) => <div className="profile-manage-row" key={profile.id}>
              <ProfileAvatar profile={profile} />
              <strong>{profile.name}</strong>
              {profile.main && <span className="profile-badge">{t("profiles.main")}</span>}
              {profile.kids && <span className="profile-badge">{t("profiles.kids")}</span>}
              <button type="button" className="btn btn-secondary" disabled={busy}
                onClick={() => setDraft(profile)}>{t("profiles.edit")}</button>
              {!profile.main && profile.hasPin && <button type="button" className="btn btn-ghost" disabled={busy}
                onClick={() => {
                  if (confirm(t("profiles.removePinConfirm", { name: profile.name }))) {
                    void mutate(() => updateProfile(profile.id, { removePin: true }, pin));
                  }
                }}>{t("profiles.removePin")}</button>}
              {!profile.main && <button type="button" className="btn btn-ghost" disabled={busy}
                onClick={() => {
                  const size = new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 })
                    .format(profile.downloadBytes / 1024 ** 2);
                  if (confirm(t("profiles.deleteConfirm", { name: profile.name, size }))) {
                    void mutate(() => deleteProfile(profile.id, pin));
                  }
                }}>{t("profiles.delete")}</button>}
            </div>)}
          </div>
          <div className="profile-actions">
            {profiles && profiles.length < 8 && <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => setDraft(newProfile)}>{t("profiles.add")}</button>}
            {!profiles && error && <button type="button" className="btn btn-secondary" onClick={() => load()}>{t("profiles.retry")}</button>}
            <button type="button" className="btn btn-ghost" onClick={onClose} data-gamepad-close>{t("profiles.close")}</button>
          </div>
        </>}
      </>}
  </ProfileDialog>;
}
