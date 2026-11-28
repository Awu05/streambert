import { useEffect, useState } from "react";
import { androidRequest } from "../../web/androidApp";

export default function AndroidAppSection() {
  const [info, setInfo] = useState(null);
  const [operation, setOperation] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    androidRequest("getInfo").then(
      (info) => { if (active) setInfo(info); },
      (error) => { if (active) setMessage(error.message); },
    );
    return () => { active = false; };
  }, []);

  async function changeServer() {
    setOperation("server");
    setMessage("");
    try {
      await androidRequest("changeServer");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setOperation(null);
    }
  }

  async function checkUpdates() {
    setOperation("update");
    setMessage("Checking…");
    try {
      const result = await androidRequest("checkUpdates");
      if (result.status === "error") throw new Error(result.message);
      setMessage(result.status === "available" ? `Update ${result.version} available.` : "You're up to date.");
    } catch (error) {
      setMessage(`Couldn't check for updates: ${error.message}`);
    } finally {
      setOperation(null);
    }
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Android app</div>
      {info && <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16, lineHeight: 1.6 }}>
        <div>Android app version {info.version}</div>
        <div>Server: {info.server}</div>
      </div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" className="btn btn-secondary" disabled={!!operation} onClick={changeServer}>Change server</button>
        <button type="button" className="btn btn-secondary" disabled={!!operation} onClick={checkUpdates}>Check for updates</button>
      </div>
      <div role="status" style={{ fontSize: 13, color: "var(--text3)", marginTop: message ? 12 : 0 }}>{message}</div>
    </section>
  );
}
