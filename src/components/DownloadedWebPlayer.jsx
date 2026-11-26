import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { storage } from "../utils/storage";
import { recordProgress } from "../utils/progressTracking";
import { apiRequest } from "../web/bridge";
import { languageLabel } from "../web/subtitleLabel";
import WebPlayer from "./WebPlayer";

export default function DownloadedWebPlayer({ download, progressKey, onClose, saveProgress, markWatched }) {
  // The server repackages the file if browsers can't play it, then returns signed links.
  const [state, setState] = useState({ mode: "preparing" });
  const marked = useRef(false);
  const id = encodeURIComponent(download.id);
  const file = `/api/files/download/${id}`;
  const key = progressKey || `local_${download.id}`;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest(`/api/files/prepare/${id}`, {}, { signal: controller.signal })
      .then((links) => setState({ mode: "ready", links }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ mode: "error", message: error.message });
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (state.mode !== "ready") return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      apiRequest(`/api/files/playing/${id}`, {}, { signal: controller.signal }).catch(() => {});
    }, 30000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [id, state.mode]);

  if (state.mode === "ready") {
    const subtitles = (download.subtitlePaths || []).map((subtitle, index) => ({
      src: state.links.subtitles[index],
      lang: subtitle.lang || "und",
      label: subtitle.label || languageLabel(subtitle.lang, `Subtitles ${index + 1}`),
      // Like the desktop app (which hands the file to the video player), start with subtitles on.
      default: index === 0,
    })).filter((track) => track.src);
    return createPortal(<WebPlayer title={download.name} src={state.links.src} kind="mp4" startAt={storage.get("dlTime_" + key)}
      subtitles={subtitles} onClose={onClose} onError={(message, detail) => setState({ mode: "error", message, detail })}
      onProgress={(value) => recordProgress(value, {
        progressKey: key, watchedThreshold: storage.get("watchedThreshold") ?? 120,
        alreadyMarked: marked,
        saveProgress: progressKey ? saveProgress : undefined,
        markWatched: progressKey ? markWatched : undefined,
      })} />, document.body);
  }

  const failed = state.mode === "error";
  return createPortal(
    <div className="web-player web-player-status web-player-overlay" role="dialog" aria-label={download.name}>
      <h2 className="web-player-title">{download.name}</h2>
      {failed ? <>
        <p className="web-player-status-message" role="alert">{state.message}</p>
        {state.detail && <p className="web-player-status-detail">{state.detail}</p>}
      </> : <>
        <div className="spinner" />
        <p className="web-player-status-message" role="status">Preparing video…</p>
      </>}
      <div className="web-player-status-actions">
        {failed && <a className="btn btn-primary" href={file} download>Download file</a>}
        <button className="btn btn-ghost" onClick={onClose} autoFocus data-gamepad-close>{failed ? "Close" : "Cancel"}</button>
      </div>
    </div>, document.body,
  );
}
