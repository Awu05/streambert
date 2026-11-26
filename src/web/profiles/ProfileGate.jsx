import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeyboardNav } from "../../utils/useKeyboardNav";
import { useGamepadNav } from "../../utils/useGamepadNav";
import ProfileAvatar from "./ProfileAvatar";
import ProfileDialog from "./ProfileDialog";
import PinPad from "./PinPad";
import ManageProfiles from "./ManageProfiles";
import { listProfiles, selectProfile, signOut, notifyProfileSwitch, profileError } from "./profilesApi";
import "../../styles/profiles.css";

export default function ProfileGate() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useKeyboardNav({ enabled: true });
  useGamepadNav({ enabled: true });

  async function load() {
    setError(null);
    try { setProfiles((await listProfiles()).profiles); }
    catch (problem) { setError(problem); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function choose(id, pin) {
    setBusy(true);
    setError(null);
    try {
      await selectProfile(id, pin);
      notifyProfileSwitch();
      location.reload();
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  }
  const closePin = () => { setSelected(null); setError(null); };

  return <main className="profile-gate">
    <section className="profile-picker">
      <h1>{t("profiles.who")}</h1>
      {loading && <div className="spinner" role="status" aria-label={t("profiles.loading")} />}
      <div className="profile-grid">
        {profiles.map((profile) => <button type="button" className="profile-tile" key={profile.id} disabled={busy}
          onClick={() => {
            setError(null);
            if (profile.hasPin) setSelected(profile);
            else void choose(profile.id);
          }}>
          <ProfileAvatar profile={profile} />
          <span className="profile-tile-name">{profile.name}{profile.hasPin && <span aria-label={t("profiles.pinProtected")}> 🔒</span>}</span>
          {profile.kids && <span className="profile-badge">{t("profiles.kids")}</span>}
        </button>)}
      </div>
      {error && !selected && <p className="profile-error" role="alert">{profileError(t, error)}</p>}
      <div className="profile-actions">
        {profiles.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setManage(true)}>{t("profiles.manage")}</button>}
        {!loading && profiles.length === 0 && <button type="button" className="btn btn-secondary" onClick={load}>{t("profiles.retry")}</button>}
        <button type="button" className="btn btn-ghost" onClick={() => signOut().catch(setError)}>{t("profiles.signOut")}</button>
      </div>
    </section>
    {selected && <ProfileDialog label={selected.name} onClose={closePin}>
      <PinPad title={t("profiles.enterPin", { name: selected.name })} onCancel={closePin}
        error={error && profileError(t, error)} onComplete={(pin) => choose(selected.id, pin)} busy={busy} />
    </ProfileDialog>}
    {manage && <ManageProfiles main={profiles.find((profile) => profile.main)} onClose={() => {
      setManage(false);
      void load();
    }} />}
  </main>;
}
