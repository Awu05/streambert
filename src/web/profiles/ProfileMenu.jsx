import { useState } from "react";
import { useTranslation } from "react-i18next";
import ProfileAvatar from "./ProfileAvatar";
import ProfileDialog from "./ProfileDialog";
import ManageProfiles from "./ManageProfiles";
import PinPad from "./PinPad";
import { leaveProfile, setMyPin, notifyProfileSwitch, profileError } from "./profilesApi";
import "../../styles/profiles.css";

function MyPin({ profile, onClose }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(profile.hasPin ? "current" : "new");
  const [current, setCurrent] = useState(undefined);
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save(pin) {
    setBusy(true);
    try {
      if (await window.electron.flushStorage?.() === false) throw new Error();
      await setMyPin(current, pin);
      notifyProfileSwitch();
      location.reload();
    } catch (problem) {
      setError(profileError(t, problem));
      setStep(profile.hasPin ? "current" : "new");
      setBusy(false);
    }
  }
  async function enter(pin) {
    setError(null);
    if (step === "current") {
      setCurrent(pin);
      setStep("new");
    } else if (step === "new") {
      setNewPin(pin);
      setStep("confirm");
    } else if (pin === newPin) await save(pin);
    else {
      setError(t("profiles.pinMismatch"));
      setStep("new");
    }
  }
  return <ProfileDialog label={t("profiles.myPin")} onClose={onClose}>
    <PinPad key={step} title={t(`profiles.pinStep.${step}`)} onComplete={enter} onCancel={onClose} error={error} busy={busy} />
    {profile.hasPin && current && step === "new" && <button type="button" className="btn btn-ghost"
      disabled={busy} onClick={() => save(null)}>{t("profiles.removePin")}</button>}
  </ProfileDialog>;
}

export default function ProfileMenu({ profile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(null); setError(null); };
  async function leave() {
    setBusy(true);
    setError(null);
    try {
      if (await window.electron.flushStorage?.() === false) throw new Error();
      await leaveProfile();
      notifyProfileSwitch();
      location.reload();
    } catch (problem) {
      setError(problem);
      setBusy(false);
    }
  }
  return <>
    <button type="button" className="sidebar-btn profile-sidebar-button" aria-label={t("profiles.menu", { name: profile.name })}
      title={profile.name} aria-expanded={Boolean(open)} onClick={() => setOpen("menu")}>
      <ProfileAvatar profile={profile} />
    </button>
    {open === "menu" && <ProfileDialog label={t("profiles.menu", { name: profile.name })} onClose={close}>
      <h2>{profile.name}</h2>
      {error && <p className="profile-error" role="alert">{profileError(t, error)}</p>}
      <div className="profile-menu">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={leave}>{t("profiles.switch")}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setOpen("pin")}>{t("profiles.myPin")}</button>
        {profile.main && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setOpen("manage")}>{t("profiles.manage")}</button>}
        <button type="button" className="btn btn-ghost" onClick={close} data-gamepad-close>{t("profiles.close")}</button>
      </div>
    </ProfileDialog>}
    {open === "pin" && <MyPin profile={profile} onClose={close} />}
    {open === "manage" && <ManageProfiles main={profile} onClose={close} />}
  </>;
}
