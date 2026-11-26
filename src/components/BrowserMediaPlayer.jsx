import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { fetchImdbId, fetchKinopoiskId, getEnabledSources, webSourceChoices } from "../utils/api";
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
  const [showSources, setShowSources] = useState(false);
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
  itemId, title, mediaType, anime, anilistId, animeLoading, apiKey, season, episode, dubMode, onDubModeChange,
  accent, progressKey, saveProgress, markWatched, watchedThreshold,
  onClose, onNext, onEnded, overlay, onResolved, onSubtitles, onDownload,
}) {
  const { t } = useTranslation();
  const kind = anime ? "anime" : mediaType;
  const rankedSources = webSourceChoices(kind);
  const choices = rankedSources.filter((entry) => kind !== "anime" || entry.resolver || anilistId);
  const [preferred, setPreferred] = useState(() => storage.get(STORAGE_KEYS.PLAYER_SOURCE));
  const selected = choices.find(({ id }) => id === preferred);
  const waitingForAnime = kind === "anime" && animeLoading && !anilistId &&
    (!choices.length || rankedSources.some((entry) => entry.id === preferred && entry.animeUrl));
  const active = waitingForAnime ? undefined : selected ?? choices[0];
  const source = active?.id;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ mode: "loading" });
  const [customTracks, setCustomTracks] = useState([]);
  const marked = useRef(false);
  const savedPosition = () => storage.get("dlTime_" + progressKey) || 0;
  const progressStart = useRef(savedPosition());
  const statusPanel = useRef(null);
  const hianime = active?.resolver === "hianime";
  const idType = active?.idType;
  const animeAudio = kind === "anime" ? dubMode : undefined;
  const selectedAnilistId = kind === "anime" && !hianime ? anilistId : null;
  const subtitleLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG);
  useEffect(() => {
    statusPanel.current?.querySelector(status.mode === "error" && source ? ".btn-primary" : "button")?.focus();
  }, [status.mode, source]);

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
    async function resolve() {
      if (waitingForAnime) return;
      if (!source) {
        setStatus({ mode: "error", message: t("player.noSource") });
        return;
      }
      const payload = { sourceId: source, mediaType: kind, requestId, clientId, subtitleLang };
      if (hianime) {
        payload.args = { title, seasonNumber: season || 1, episodeNumber: episode || 1,
          isMovie: mediaType === "movie", translationType: animeAudio };
      } else if (kind === "anime") {
        Object.assign(payload, { anilist: selectedAnilistId, episode: episode || 1, lang: animeAudio === "dub" ? "dub" : "sub" });
      } else {
        const fetchId = idType === "imdb" ? fetchImdbId : idType === "kinopoisk" ? fetchKinopoiskId : null;
        const id = fetchId ? await fetchId(mediaType, itemId, apiKey) : itemId;
        Object.assign(payload, { id, season, episode });
      }
      if (controller.signal.aborted) return;
      const stream = await apiRequest(hianime ? "/api/play/hianime" : "/api/play/resolve", payload, { signal: controller.signal });
      if (controller.signal.aborted) return;
      onResolved?.(stream.src);
      onSubtitles?.(stream.subtitles.map(({ src, lang }) => ({ url: src, lang })));
      setStatus({ mode: "ready", stream });
    }
    void resolve().catch((error) => {
      if (!controller.signal.aborted) setStatus({ mode: "error", message: error.message });
    });
    return () => {
      controller.abort();
      window.electron.offPlayQueue(handle);
    };
  }, [itemId, title, mediaType, kind, season, episode, source, idType, hianime, animeAudio,
    selectedAnilistId, waitingForAnime, subtitleLang, apiKey, attempt, onResolved, onSubtitles, t]);

  function changeSource(value) {
    if (source === value) return;
    progressStart.current = savedPosition();
    setShowSources(false);
    setPreferred(value);
    storage.set(STORAGE_KEYS.PLAYER_SOURCE, value);
  }
  function retry() {
    progressStart.current = savedPosition();
    setAttempt((number) => number + 1);
  }

  const subtitleSearch = useSubtitleSearchMenu({
    itemId, mediaType, season, episode,
    onPick: (track) => setCustomTracks((current) => [...current.filter(({ src }) => src !== track.src), track]),
  });
  const externalMenu = useExternalPlayerMenu(status.stream?.external, status.stream?.kind);
  const sourceLabel = active?.label;
  const sourceStatus = (entry) => t("player.sourceStatus." + entry.web[kind]);

  if (status.mode === "ready") {
    const { stream } = status;
    const subtitles = [
      // HiAnime streams are subtitled releases, so their subtitles start on (as on desktop).
      ...stream.subtitles.map((track) => ({ ...track, label: languageLabel(track.lang), default: hianime })),
      ...customTracks,
    ];
    const menus = [
      {
        id: "source", label: t("player.source"), value: sourceLabel,
        items: choices.map((entry) => ({
          key: entry.id, label: entry.label, selected: entry.id === source,
          detail: sourceStatus(entry), onSelect: () => changeSource(entry.id),
        })),
      },
      kind === "anime" && {
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

  const ordered = getEnabledSources().filter(({ id }) => choices.some((choice) => choice.id === id));
  const currentIndex = ordered.findIndex(({ id }) => id === source);
  const next = ordered.length > 1 && ordered[(currentIndex + 1) % ordered.length];
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
        {sourceLabel && <p className="web-player-status-source">{t("player.source")}: {sourceLabel}</p>}
        {status.detail && <p className="web-player-status-detail">{status.detail}</p>}
      </> : hianime && !status.position ? (
        <div className="web-player-loader"><HiAnimeLoader what={mediaType === "movie" ? "movie" : "episode"} /></div>
      ) : <>
        <div className="spinner" />
        <p className="web-player-status-message" role="status">
          {status.position ? `Waiting for a free slot (${status.position} ahead)…` : `Finding the stream on ${sourceLabel ?? ""}…`}
        </p>
      </>}
      <div className="web-player-status-actions">
        {failed && source && <button className="btn btn-primary" onClick={retry}>Retry</button>}
        {failed && next && <button className="btn btn-secondary" onClick={() => changeSource(next.id)}>{t("player.trySource", { source: next.label })}</button>}
        {failed && choices.length > 1 && <button type="button" className="btn btn-ghost" aria-expanded={showSources}
          onClick={() => setShowSources(!showSources)}>{t("player.source")}</button>}
        <button className="btn btn-ghost" onClick={onClose} data-gamepad-close>{failed ? "Close" : "Cancel"}</button>
      </div>
      {failed && showSources && <div className="web-player-status-sources">
        {choices.map((entry) => <button type="button" className="btn btn-secondary" key={entry.id}
          aria-pressed={entry.id === source} onClick={() => changeSource(entry.id)}>
          {entry.label} · {sourceStatus(entry)}
        </button>)}
      </div>}
    </div>, document.body,
  );
}
