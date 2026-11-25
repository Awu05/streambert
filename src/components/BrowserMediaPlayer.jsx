import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PLAYER_SOURCES, getSourceUrl } from "../utils/api";
import { isSourceAvailableInBrowser } from "../utils/capabilities";
import { recordProgress } from "../utils/progressTracking";
import { storage, secureStorage, STORAGE_KEYS } from "../utils/storage";
import { apiRequest, getClientId } from "../web/bridge";
import { languageLabel } from "../web/subtitleLabel";
import { useExternalPlayerMenu } from "./ExternalPlayerMenu";
import HiAnimeLoader from "./HiAnimeLoader";
import WebPlayer from "./WebPlayer";

// The "Find subtitles" row of the Options panel: searches Wyzie when opened.
function useSubtitleSearchMenu({ itemId, mediaType, season, episode, onPick }) {
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState("");
  async function search() {
    setStatus("Searching…");
    setResults([]);
    try {
      const wyzieApiKey = await secureStorage.get(STORAGE_KEYS.WYZIE_API_KEY);
      if (!wyzieApiKey) throw new Error("Add a Wyzie key in Settings to search for subtitles.");
      const response = await window.electron.searchSubtitles({
        tmdbId: itemId, mediaType, season, episode, wyzieApiKey,
        languages: storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en",
      });
      if (!response.ok) throw new Error(response.error);
      setResults((response.results || []).slice(0, 20));
      setStatus(response.results?.length ? "" : "No subtitles found");
    } catch (error) { setStatus(error.message); }
  }
  async function pick(result) {
    setStatus("Adding subtitle…");
    try {
      const response = await window.electron.getSubtitleUrl({ fileId: result.file_id });
      if (!response.ok) throw new Error(response.error);
      onPick({
        src: `/api/subtitle?u=${encodeURIComponent(response.url)}`,
        lang: result.language || "und",
        label: [result.language?.toUpperCase(), result.release || result.file_name].filter(Boolean).join(" · ") || "Subtitle",
        picked: true,
      });
      setStatus("Subtitle added and turned on");
    } catch (error) { setStatus(error.message); }
  }
  return {
    id: "find-subtitles", label: "Find subtitles", status,
    onOpen: () => { if (results === null) void search(); },
    items: (results || []).map((result) => ({
      key: result.file_id, label: result.release || result.file_name || "Subtitle",
      detail: result.language?.toUpperCase(), keepOpen: true, onSelect: () => pick(result),
    })),
  };
}

let requestNumber = 0;

export default function BrowserMediaPlayer({
  itemId, title, mediaType, anime, season, episode, dubMode, onDubModeChange,
  accent, progressKey, saveProgress, markWatched, watchedThreshold,
  onClose, onNext, onEnded, overlay, onResolved, onSubtitles, onDownload,
}) {
  const choices = PLAYER_SOURCES.filter(({ id }) =>
    isSourceAvailableInBrowser(id, id === "hianime" ? (anime ? "anime" : mediaType) : mediaType));
  const selected = storage.get(STORAGE_KEYS.PLAYER_SOURCE);
  const [source, setSource] = useState(() => choices.some(({ id }) => id === selected) ? selected :
    (anime ? choices.find(({ id }) => id === "hianime")?.id : null) || choices[0]?.id);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ mode: "loading" });
  const [customTracks, setCustomTracks] = useState([]);
  const marked = useRef(false);
  const progressStart = useRef(storage.get("dlTime_" + progressKey) || 0);
  const statusPanel = useRef(null);
  const hianime = source === "hianime";
  useEffect(() => {
    statusPanel.current?.querySelector(status.mode === "error" ? ".btn-primary" : "button")?.focus();
  }, [status.mode]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = String(++requestNumber);
    const clientId = getClientId();
    const handle = window.electron.onPlayQueue(({ position, requestId: queuedId }) => {
      if (queuedId === requestId) setStatus({ mode: "loading", position });
    });
    onResolved?.(null);
    onSubtitles?.([]);
    setCustomTracks([]);
    setStatus({ mode: "loading" });
    const payload = hianime ? {
      clientId,
      args: { title, seasonNumber: season || 1, episodeNumber: episode || 1, isMovie: mediaType === "movie", translationType: dubMode },
    } : {
      sourceId: source, mediaType, requestId, clientId,
      url: getSourceUrl(source, mediaType, itemId, season, episode),
    };
    if (source) apiRequest(hianime ? "/api/play/hianime" : "/api/play/resolve", payload, { signal: controller.signal })
      .then((stream) => {
        if (controller.signal.aborted) return;
        onResolved?.(stream.src);
        onSubtitles?.(stream.subtitles.map(({ src, lang }) => ({ url: src, lang })));
        setStatus({ mode: "ready", stream });
      }).catch((error) => {
        if (!controller.signal.aborted) setStatus({ mode: "error", message: error.message });
      });
    else setStatus({ mode: "error", message: "No browser source is available for this title." });
    return () => {
      controller.abort();
      window.electron.offPlayQueue(handle);
    };
    // dubMode only changes what HiAnime returns, so other sources ignore it.
  }, [itemId, title, mediaType, season, episode, source, hianime && dubMode, attempt, onResolved, onSubtitles]);

  function changeSource(value) {
    if (source === value) return;
    progressStart.current = storage.get("dlTime_" + progressKey) || 0;
    setSource(value);
    storage.set(STORAGE_KEYS.PLAYER_SOURCE, value);
  }
  function retry() {
    progressStart.current = storage.get("dlTime_" + progressKey) || 0;
    setAttempt((number) => number + 1);
  }

  const subtitleSearch = useSubtitleSearchMenu({
    itemId, mediaType, season, episode,
    onPick: (track) => setCustomTracks((current) => [...current.filter(({ src }) => src !== track.src), track]),
  });
  const externalMenu = useExternalPlayerMenu(status.stream?.external, status.stream?.kind);
  const sourceLabel = (id) => PLAYER_SOURCES.find((entry) => entry.id === id)?.label || id;

  if (status.mode === "ready") {
    const { stream } = status;
    const subtitles = [
      // HiAnime streams are subtitled releases, so their subtitles start on (as on desktop).
      ...stream.subtitles.map((track) => ({ ...track, label: languageLabel(track.lang), default: hianime })),
      ...customTracks,
    ];
    const menus = [
      {
        id: "source", label: "Source", value: sourceLabel(source),
        // Working sources first, then the ones the browser build can't play.
        items: [...choices, ...PLAYER_SOURCES.filter((entry) => !choices.includes(entry))].map(({ id, label }) => {
          const available = choices.some((entry) => entry.id === id);
          return {
            key: id, label, selected: id === source, disabled: !available,
            detail: available ? undefined : "Not available in the browser", onSelect: () => changeSource(id),
          };
        }),
      },
      hianime && {
        id: "audio", label: "Audio", value: dubMode === "dub" ? "Dub" : "Sub",
        items: [["sub", "Subtitled (Japanese audio)"], ["dub", "Dubbed (English audio)"]].map(([mode, label]) => ({
          key: mode, label, selected: dubMode === mode, onSelect: () => onDubModeChange?.(mode),
        })),
      },
      subtitleSearch,
      externalMenu,
      onDownload && { id: "download", label: "Download", onSelect: onDownload },
    ].filter(Boolean);
    return createPortal(<WebPlayer key={stream.streamId}
      src={stream.src} kind={stream.kind} startAt={progressStart.current} subtitles={subtitles}
      title={title} accent={accent} onClose={onClose} onNext={onNext} onEnded={onEnded} overlay={overlay}
      onError={(message, detail) => setStatus({ mode: "error", message, detail })}
      onProgress={(value) => recordProgress(value, { progressKey, saveProgress, markWatched, watchedThreshold, alreadyMarked: marked })}
      menus={menus} />, document.body);
  }

  const next = choices.length > 1 && choices[(choices.findIndex(({ id }) => id === source) + 1) % choices.length];
  const failed = status.mode === "error";
  return createPortal(
    <div className="web-player web-player-status web-player-overlay" ref={statusPanel} role="dialog" aria-label={title}
      onKeyDown={(event) => {
        if (["Escape", "Backspace", "GoBack", "BrowserBack"].includes(event.key)) {
          event.preventDefault();
          onClose();
        }
      }}>
      <h2 className="web-player-title">{title}</h2>
      {failed ? <>
        <p className="web-player-status-message" role="alert">{status.message}</p>
        <p className="web-player-status-source">Source: {sourceLabel(source)}</p>
        {status.detail && <p className="web-player-status-detail">{status.detail}</p>}
      </> : hianime && !status.position ? (
        <div className="web-player-loader"><HiAnimeLoader what={mediaType === "movie" ? "movie" : "episode"} /></div>
      ) : <>
        <div className="spinner" />
        <p className="web-player-status-message" role="status">
          {status.position ? `Waiting for a free slot (${status.position} ahead)…` : `Finding the stream on ${sourceLabel(source)}…`}
        </p>
      </>}
      <div className="web-player-status-actions">
        {failed && <button className="btn btn-primary" onClick={retry}>Retry</button>}
        {failed && next && <button className="btn btn-secondary" onClick={() => changeSource(next.id)}>Try {next.label}</button>}
        <button className="btn btn-ghost" onClick={onClose} data-gamepad-close>{failed ? "Close" : "Cancel"}</button>
      </div>
    </div>, document.body,
  );
}
