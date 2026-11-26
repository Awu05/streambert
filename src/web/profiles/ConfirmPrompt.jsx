import { useTranslation } from "react-i18next";
import ProfileDialog from "./ProfileDialog";

// In-app confirmation (works with touch and the TV remote, unlike confirm()).
export default function ConfirmPrompt({ title, message, confirmLabel, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return <ProfileDialog label={title} onClose={onCancel}>
    <h2>{title}</h2>
    <p className="profile-confirm-message">{message}</p>
    <div className="profile-actions">
      <button type="button" className="btn btn-primary" autoFocus onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" className="btn btn-ghost" onClick={onCancel} data-gamepad-close>{t("profiles.cancel")}</button>
    </div>
  </ProfileDialog>;
}
