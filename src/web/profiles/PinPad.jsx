import { useState } from "react";
import { useTranslation } from "react-i18next";
import { nextPin } from "./pin";

export default function PinPad({ title, onComplete, onCancel, error, busy }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function enter(key) {
    if (submitting || busy) return;
    const next = nextPin(pin, key);
    if (next.length < 4) {
      setPin(next);
      return;
    }
    setPin(next);
    setSubmitting(true);
    try { await onComplete(next); }
    finally {
      setPin("");
      setSubmitting(false);
    }
  }

  return <div className="profile-pin" onKeyDown={(event) => {
    if (!/^\d$/.test(event.key) && event.key !== "Backspace") return;
    event.preventDefault();
    if (!event.repeat) void enter(event.key === "Backspace" ? "back" : event.key);
  }}>
    <h2>{title}</h2>
    <div className={`profile-digits${error ? " profile-digits-error" : ""}`} aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => <span key={index}>{index < pin.length ? "•" : ""}</span>)}
    </div>
    {error && <p className="profile-error" role="alert">{error}</p>}
    <div className="profile-keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0"].map((key) =>
        <button key={key} type="button" className="btn btn-secondary"
          aria-disabled={submitting || busy} autoFocus={key === "1"}
          aria-label={key === "back" ? t("profiles.eraseDigit") : undefined}
          onClick={() => enter(key)}>{key === "back" ? "⌫" : key}</button>)}
      <button type="button" className="btn btn-ghost" onClick={onCancel} data-gamepad-close>{t("profiles.cancel")}</button>
    </div>
  </div>;
}
