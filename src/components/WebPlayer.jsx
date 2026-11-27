import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { dashLevels } from "../web/dashLevels";
import { mapPlayerKey } from "../web/playerKeys";
import { pickInDirection } from "../utils/gamepadSpatialNav";
import { trackLanguage } from "../web/subtitleLabel";
import { usePictureInPicture } from "../web/usePictureInPicture";
import { usePictureBox, useSubtitles } from "../web/usePlayerSubtitles";
import {
  PlayIcon, PauseIcon, SeekBackIcon, SeekForwardIcon, VolumeIcon, MutedIcon,
  FullscreenIcon, ExitFullscreenIcon, NextEpisodeIcon, SettingsIcon, CloseIcon,
  CheckIcon, ChevronLeftIcon, ChevronRightIcon, PictureInPictureIcon, SubtitlesIcon,
} from "./Icons";
import "../styles/webPlayer.css";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not([tabindex="-1"])';
const DIRECTIONS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const BACK_KEYS = ["Escape", "Backspace", "GoBack", "BrowserBack"];
const EMPTY_TRACKS = [];

// Left/Right stay within the focused control's row; Up/Down move between rows.
function nextControl(from, candidates, direction) {
  if (direction === "up" || direction === "down") return pickInDirection(from, candidates, direction);
  const rect = from.getBoundingClientRect();
  const middle = (rect.top + rect.bottom) / 2;
  const row = candidates.filter((element) => {
    const other = element.getBoundingClientRect();
    return other.top <= middle && other.bottom >= middle;
  });
  return pickInDirection(from, row, direction);
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const hasSubmenu = (menu) => !!(menu.items || menu.note || menu.extra);

function OptionsPanel({ panelRef, menus, open, onRow, onItem, onBack }) {
  const menu = menus.find((entry) => entry.id === open);
  if (!menu) {
    return (
      <div ref={panelRef} className="web-player-panel" role="menu" aria-label="Options">
        {menus.map((entry) => entry.info ? (
          <p key={entry.id} className="web-player-note">{entry.label}</p>
        ) : (
          <button key={entry.id} className="web-player-row" data-menu={entry.id} role="menuitem" onClick={() => onRow(entry)}>
            <span>{entry.label}</span>
            {entry.value && <span className="web-player-row-value">{entry.value}</span>}
            {hasSubmenu(entry) && <ChevronRightIcon size={18} />}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div ref={panelRef} className="web-player-panel" role="menu" aria-label={menu.label}>
      <button className="web-player-row web-player-row--back" onClick={onBack}>
        <ChevronLeftIcon size={18} /><span>{menu.label}</span>
      </button>
      {menu.status && <p className="web-player-note" role="status">{menu.status}</p>}
      {menu.items?.map((item) => {
        const content = <>
          <span className="web-player-check">{item.selected && <CheckIcon />}</span>
          <span className="web-player-row-label">{item.label}{item.detail && <small>{item.detail}</small>}</span>
        </>;
        return item.href
          ? <a key={item.key} className="web-player-row" href={item.href} role="menuitem" onClick={() => onItem(item)}>{content}</a>
          : <button key={item.key} className="web-player-row" role="menuitemradio" aria-checked={!!item.selected}
            disabled={item.disabled} onClick={() => onItem(item)}>{content}</button>;
      })}
      {menu.extra}
      {menu.note && <p className="web-player-note">{menu.note}</p>}
    </div>
  );
}

/**
 * Full-screen player for the browser build.
 * `menus` adds rows to the Options panel: { id, label, value?, items?, onSelect?,
 * onOpen?, status?, note?, extra? }; an item is { key, label, detail?, selected?,
 * disabled?, href?, keepOpen?, onSelect? }.
 * Subtitles: { src, lang, label, default? }. A new pickedSubtitle selects that track.
 */
export default function WebPlayer(props) {
  const home = useRef(null);
  const [host] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    home.current.append(host);
    return () => host.remove();
  }, [host]);

  return <><div ref={home} />{createPortal(<Player {...props} host={host} home={home} />, host)}</>;
}

function Player({
  src, kind, startAt, subtitles = EMPTY_TRACKS, pickedSubtitle, title, accent, onProgress, onEnded,
  onClose, onError, onNext, overlay, menus = [],
  host, home,
}) {
  const { t } = useTranslation();
  const container = useRef(null);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const panelRef = useRef(null);
  const playButton = useRef(null);
  const optionsButton = useRef(null);
  const hls = useRef(null);
  const dash = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onProgress, onEnded, onError, t };
  const resume = useRef(startAt);
  const hideTimer = useRef(null);
  const hintTimer = useRef(null);
  const lastDown = useRef(null);
  const pointerType = useRef("mouse");
  const returnTo = useRef(null);
  const [controls, setControls] = useState(true);
  const [paused, setPaused] = useState(true);
  const [started, setStarted] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [autoMuted, setAutoMuted] = useState(false);
  const [isFullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState([]);
  const [quality, setQuality] = useState(-1);
  const [dashTracks, setDashTracks] = useState(EMPTY_TRACKS);
  const [hint, setHint] = useState("");
  const [panel, setPanel] = useState(null);
  const pictureInPicture = usePictureInPicture(videoRef, host, home);
  const { tracks, selected, selectTrack, toggleSubtitles, caption } = useSubtitles(
    videoRef, subtitles, pickedSubtitle, pictureInPicture.native, dash, dashTracks,
  );
  const picture = usePictureBox(videoRef);

  function showControls() {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 3000);
  }

  function showHint(message, duration) {
    setHint(message);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(""), duration);
  }

  useEffect(() => { container.current?.focus(); }, []);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    let native = kind !== "hls" && kind !== "dash";
    const report = () => callbacks.current.onProgress?.({ currentTime: video.currentTime, duration: video.duration });
    const interval = setInterval(() => { if (!video.paused) report(); }, 5000);
    // Autoplay with sound can be refused (iOS needs a fresh tap): then start muted.
    const tryPlay = () => {
      void video.play().catch((error) => {
        if (cancelled || error?.name !== "NotAllowedError" || video.muted) return;
        video.muted = true;
        setMuted(true);
        setAutoMuted(true);
        void video.play().catch(() => {});
      });
    };
    const playNatively = () => {
      native = true;
      video.src = src;
      tryPlay();
    };
    if (kind === "dash") {
      const reportError = (detail) => callbacks.current.onError?.(callbacks.current.t("player.streamError"), detail);
      if (!window.MediaSource && !window.ManagedMediaSource) {
        callbacks.current.onError?.(callbacks.current.t("player.dashUnsupported"));
      } else {
        import("dashjs").then(({ MediaPlayer }) => {
          if (cancelled) return;
          const player = MediaPlayer().create();
          dash.current = player;
          player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
          player.on(MediaPlayer.events.TEXT_TRACKS_ADDED, ({ tracks }) => {
            if (cancelled) return;
            const native = Array.from(video.textTracks);
            setDashTracks(tracks.map(({ id, lang, kind }) => native.find((track) =>
              track.label === String(id ?? lang ?? "") && track.language === (lang ?? "") && track.kind === kind,
            )));
          });
          player.on(MediaPlayer.events.STREAM_INITIALIZED, () => {
            if (cancelled) return;
            setLevels(dashLevels(player.getRepresentationsByType("video")));
            setQuality(-1);
            tryPlay();
          });
          player.on(MediaPlayer.events.ERROR, ({ error }) => {
            if (!cancelled) reportError("dash.js: " + (error?.message || error?.code || error || "unknown error"));
          });
          video.disableRemotePlayback = true;
          player.initialize(video, src, false, resume.current > 0 ? resume.current : undefined);
        }).catch((error) => {
          if (!cancelled) reportError("dash.js: " + error.message);
        });
      }
    } else if (native) playNatively();
    else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) return playNatively();
          throw new Error("HLS is unavailable in this browser");
        }
        const instance = new Hls({ startPosition: resume.current || -1, enableInterstitialPlayback: false });
        hls.current = instance;
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          setLevels(instance.levels);
          tryPlay();
        });
        instance.on(Hls.Events.ERROR, (_event, error) => {
          if (!error.fatal) return;
          const status = error.response?.code ? ` (HTTP ${error.response.code})` : "";
          callbacks.current.onError?.("The stream could not play. Try another source.", `hls.js: ${error.details}${status}`);
        });
        // Some streams start after 0: jump to the first buffered frame.
        function alignFirstBuffer() {
          if (!video.buffered.length) return;
          instance.off(Hls.Events.FRAG_BUFFERED, alignFirstBuffer);
          const start = video.buffered.start(0);
          if (!resume.current && video.currentTime === 0 && start > 0) {
            video.currentTime = Math.min(start + 0.1, (start + video.buffered.end(0)) / 2);
          }
        }
        instance.on(Hls.Events.FRAG_BUFFERED, alignFirstBuffer);
        instance.loadSource(src);
        instance.attachMedia(video);
      }).catch((error) => { if (!cancelled) callbacks.current.onError?.(error.message); });
    }
    const onMetadata = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (native && resume.current > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(resume.current, Math.max(0, video.duration - 0.25));
      }
    };
    const ended = () => { report(); callbacks.current.onEnded?.(); };
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("pause", report);
    video.addEventListener("ended", ended);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(hideTimer.current);
      clearTimeout(hintTimer.current);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("pause", report);
      video.removeEventListener("ended", ended);
      report();
      hls.current?.destroy();
      hls.current = null;
      dash.current?.reset();
      dash.current = null;
      if (kind === "dash") video.disableRemotePlayback = false;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind]);

  // Opening the panel or a submenu moves focus into it.
  useEffect(() => {
    if (!panel) return;
    const target = returnTo.current && panelRef.current?.querySelector(`[data-menu="${returnTo.current}"]`);
    returnTo.current = null;
    (target || panelRef.current?.querySelector(FOCUSABLE))?.focus();
  }, [panel]);

  function togglePlay() {
    const video = videoRef.current;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }
  function seek(delta) {
    const video = videoRef.current;
    if (Number.isFinite(video.duration)) {
      video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta));
    }
  }
  function changeVolume(value) {
    const video = videoRef.current;
    video.volume = Math.max(0, Math.min(1, value));
    video.muted = video.volume === 0;
    setVolume(video.volume);
    setMuted(video.muted);
  }
  function toggleMute() {
    const video = videoRef.current;
    setAutoMuted(false);
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) changeVolume(0.5);
    setMuted(video.muted);
  }
  function setLevel(level) {
    const player = dash.current;
    if (player) {
      player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: level === -1 } } } });
      if (level !== -1) player.setRepresentationForTypeByIndex("video", levels[level].index);
    } else if (hls.current) {
      hls.current.currentLevel = level;
    }
    setQuality(level);
  }
  function fullscreen() {
    if (pictureInPicture.floating) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else if (container.current.requestFullscreen) void container.current.requestFullscreen().catch(() => {});
    else videoRef.current.webkitEnterFullscreen?.();
  }
  async function togglePictureInPicture() {
    if (!await pictureInPicture.toggle() && videoRef.current) {
      showHint(t("player.pictureInPictureError"), 4000);
    }
  }
  function closePanel() {
    setPanel(null);
    optionsButton.current?.focus();
  }
  function panelBack() {
    if (panel === "main") return closePanel();
    returnTo.current = panel;
    setPanel("main");
  }
  function chooseRow(menu) {
    if (hasSubmenu(menu)) {
      menu.onOpen?.();
      setPanel(menu.id);
    } else {
      menu.onSelect?.();
      closePanel();
    }
  }
  function chooseItem(item) {
    item.onSelect?.();
    if (!item.keepOpen && !item.href) closePanel();
  }

  const playerMenus = [];
  if (tracks.length) {
    playerMenus.push({
      id: "subtitles", label: "Subtitles",
      value: selected?.label || "Off",
      items: [
        { key: "off", label: "Off", selected: !selected, onSelect: () => selectTrack(null) },
        ...tracks.map((track) => ({
          key: track.key, label: track.label,
          selected: selected === track, onSelect: () => selectTrack(track.id),
        })),
      ],
    });
  }
  if (levels.length > 1) {
    const levelLabel = (level, index) => (level.height ? `${level.height}p` : `Level ${index + 1}`);
    playerMenus.push({
      id: "quality", label: "Quality",
      value: quality === -1 || !levels[quality] ? "Auto" : levelLabel(levels[quality], quality),
      items: [
        { key: "auto", label: "Auto", selected: quality === -1, onSelect: () => setLevel(-1) },
        ...levels.map((level, index) => ({
          key: String(index), label: levelLabel(level, index), selected: quality === index, onSelect: () => setLevel(index),
        })),
      ],
    });
  }
  const allMenus = [...playerMenus, ...menus];

  function handleKey(event) {
    showControls();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { key, target } = event;
    if (key.toLowerCase() === "f" && target.tagName !== "INPUT") {
      event.preventDefault();
      fullscreen();
      return;
    }
    // Focus on the video itself: remote shortcuts.
    if (target === container.current) {
      const mapped = mapPlayerKey(event, { lastDownAt: lastDown.current, now: Date.now() });
      lastDown.current = mapped.lastDownAt;
      if (!mapped.action) return;
      event.preventDefault();
      event.stopPropagation();
      if (mapped.action === "playPause") togglePlay();
      if (mapped.action === "seekBack") seek(-10);
      if (mapped.action === "seekForward") seek(10);
      if (mapped.action === "showControls") playButton.current?.focus();
      if (mapped.action === "exit") onClose();
      if (mapped.action === "hintExit") showHint("Press ↓ again to exit", 1900);
      return;
    }
    // Focus on a control or in the Options panel: arrows move, Back steps out.
    const inPanel = !!panelRef.current?.contains(target);
    if (BACK_KEYS.includes(key) && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      if (inPanel) panelBack();
      else container.current.focus();
      return;
    }
    const direction = DIRECTIONS[key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.dataset.seek !== undefined && (direction === "left" || direction === "right")) {
      seek(direction === "left" ? -10 : 10);
      return;
    }
    const scope = inPanel ? panelRef.current : container.current;
    const candidates = [...scope.querySelectorAll(FOCUSABLE)]
      .filter((element) => inPanel || !panelRef.current?.contains(element));
    const next = nextControl(target, candidates, direction);
    if (next) next.focus();
    else if (inPanel && direction === "left") panelBack();
    else if (!inPanel && direction === "down") container.current.focus();
  }

  function handleVideoClick() {
    if (panel) return closePanel();
    const revealOnly = pointerType.current === "touch" && !controls && !paused;
    showControls();
    if (!revealOnly) togglePlay();
  }

  const visible = controls || paused || !!panel;
  // Subtitles sit near the bottom of the picture, above the controls while they show.
  const captionBottom = Math.max(picture.gap + picture.height * 0.06,
    visible ? (controlsRef.current?.offsetHeight || 0) + 12 : 16);
  const captionSize = Math.min(44, Math.max(15, (picture.height || 400) * 0.055));
  const playLabel = paused ? "Play" : "Pause";
  const muteLabel = muted ? "Unmute" : "Mute";
  const fullscreenLabel = isFullscreen ? "Exit full screen" : "Full screen";
  const pictureInPictureLabel = pictureInPicture.active ? "Exit picture-in-picture" : "Picture-in-picture";

  return (
    <section ref={container} className="web-player" tabIndex={0} data-web-player
      data-floating={pictureInPicture.floating}
      data-idle={!visible} aria-label={title} style={accent ? { "--wp-accent": accent } : undefined}
      onKeyDown={handleKey} onPointerMove={showControls}
      onPointerDown={(event) => { pointerType.current = event.pointerType; }}>
      <video ref={videoRef} playsInline preload="metadata" onClick={handleVideoClick}
        onTimeUpdate={() => setAt(videoRef.current.currentTime)} onDurationChange={() => {
          const next = videoRef.current.duration;
          if (Number.isFinite(next)) setDuration(next);
        }} onPlay={() => { setPaused(false); setStarted(true); showControls(); }} onPause={() => setPaused(true)}
        onError={() => {
          const error = videoRef.current.error;
          if (error) onError?.(error.code === 4
            ? "This video format cannot play in this browser." : "The video could not play.",
          `${hls.current ? "hls.js" : "built-in player"}: error ${error.code}${error.message ? ` (${error.message})` : ""}`);
        }}>
        {subtitles.map((track, index) => (
          <track key={`${track.src}-${index}`} data-player-subtitle kind="subtitles" src={track.src}
            default={track.src === selected?.id}
            srcLang={trackLanguage(track.lang)} label={track.label || track.lang || "Subtitles"} />
        ))}
      </video>
      {selected && !pictureInPicture.native && caption && <div className="web-player-caption" aria-live="polite"
        style={{ bottom: captionBottom, fontSize: captionSize }}><span>{caption}</span></div>}
      {overlay}
      {hint && <div className="web-player-hint" role="status">{hint}</div>}
      {autoMuted && muted && <button className="web-player-unmute" onClick={toggleMute}>
        <MutedIcon /><span>Tap to unmute</span>
      </button>}
      {!started && paused && !panel && <button className="web-player-bigplay" onClick={togglePlay} aria-label="Play">
        <PlayIcon />
      </button>}
      <div className="web-player-top" data-visible={visible}>
        <h2 className="web-player-title">{title}</h2>
        <button className="web-player-icon" onClick={onClose} aria-label="Close player" title="Close" data-gamepad-close>
          <CloseIcon />
        </button>
      </div>
      <div ref={controlsRef} className="web-player-controls" data-visible={visible}>
        <div className="web-player-timeline">
          <span>{formatTime(at)}</span>
          <input type="range" aria-label="Seek" data-seek min="0" max={duration || 1} step="0.1"
            value={Math.min(at, duration)} disabled={!duration}
            onChange={(event) => { videoRef.current.currentTime = Number(event.target.value); }} />
          <span>{formatTime(duration)}</span>
        </div>
        <div className="web-player-bar">
          <div className="web-player-actions">
            <button ref={playButton} className="web-player-icon web-player-icon--main" onClick={togglePlay}
              aria-label={playLabel} title={playLabel}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button className="web-player-icon" onClick={() => seek(-10)} aria-label="Back 10 seconds" title="Back 10 seconds"><SeekBackIcon /></button>
            <button className="web-player-icon" onClick={() => seek(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds"><SeekForwardIcon /></button>
            <div className="web-player-volume">
              <button className="web-player-icon" onClick={toggleMute} aria-label={muteLabel} title={muteLabel}>
                {muted ? <MutedIcon /> : <VolumeIcon />}
              </button>
              <input type="range" aria-label="Volume" tabIndex={-1} min="0" max="1" step="0.05"
                value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} />
            </div>
          </div>
          <div className="web-player-actions">
            {onNext && <button className="web-player-pill" onClick={onNext} aria-label="Next episode" title="Next episode">
              <NextEpisodeIcon /><span>Next episode</span>
            </button>}
            {tracks.length > 0 && <button className="web-player-icon" onClick={toggleSubtitles}
              aria-label="Closed captions" aria-pressed={!!selected} title="Closed captions">
              <SubtitlesIcon aria-hidden="true" />
            </button>}
            {!!allMenus.length && <button ref={optionsButton} className="web-player-icon" aria-label="Options" title="Options"
              aria-expanded={!!panel} onClick={() => (panel ? closePanel() : setPanel("main"))}>
              <SettingsIcon />
            </button>}
            {pictureInPicture.available && <button className="web-player-icon" onClick={togglePictureInPicture}
              aria-label="Picture-in-picture" aria-pressed={pictureInPicture.active} title={pictureInPictureLabel}>
              <PictureInPictureIcon />
            </button>}
            {!pictureInPicture.floating && <button className="web-player-icon" onClick={fullscreen} aria-label={fullscreenLabel} title={fullscreenLabel}>
              {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>}
          </div>
        </div>
      </div>
      {panel && <OptionsPanel panelRef={panelRef} menus={allMenus} open={panel}
        onRow={chooseRow} onItem={chooseItem} onBack={panelBack} />}
    </section>
  );
}
