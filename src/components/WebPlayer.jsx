import React, { useEffect, useRef, useState } from "react";
import { mapPlayerKey } from "../web/playerKeys";
import { pickInDirection } from "../utils/gamepadSpatialNav";
import { trackLanguage } from "../web/subtitleLabel";
import {
  PlayIcon, PauseIcon, SeekBackIcon, SeekForwardIcon, VolumeIcon, MutedIcon,
  FullscreenIcon, ExitFullscreenIcon, NextEpisodeIcon, SettingsIcon, CloseIcon,
  CheckIcon, ChevronLeftIcon, ChevronRightIcon,
} from "./Icons";
import "../styles/webPlayer.css";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not([tabindex="-1"])';
const DIRECTIONS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const BACK_KEYS = ["Escape", "Backspace", "GoBack", "BrowserBack"];

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

function time(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const value = Math.floor(seconds);
  const hours = Math.floor(value / 3600);
  return [hours || null, hours ? String(Math.floor(value % 3600 / 60)).padStart(2, "0") :
    Math.floor(value / 60), String(value % 60).padStart(2, "0")].filter((part) => part !== null).join(":");
}

/**
 * Full-screen player for the browser build.
 * `menus` adds rows to the Options panel: { id, label, value?, items?, onSelect?,
 * onOpen?, status?, note?, extra? }. An item is { key, label, detail?, selected?,
 * disabled?, href?, keepOpen?, onSelect? }. Subtitle tracks with `picked: true`
 * are turned on when they are added.
 */
export default function WebPlayer({
  src, kind, startAt, subtitles = [], title, accent, onProgress, onEnded,
  onClose, onError, onNext, overlay, menus = [],
}) {
  const container = useRef(null);
  const videoRef = useRef(null);
  const panelRef = useRef(null);
  const playButton = useRef(null);
  const optionsButton = useRef(null);
  const hls = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onProgress, onEnded, onError };
  const resume = useRef(startAt);
  const hideTimer = useRef(null);
  const hintTimer = useRef(null);
  const lastDown = useRef(null);
  const pointerType = useRef("mouse");
  const returnTo = useRef(null);
  const seenTracks = useRef(new Set(subtitles.map((track) => track.src)));
  const [controls, setControls] = useState(true);
  const [paused, setPaused] = useState(true);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setFullscreen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [levels, setLevels] = useState([]);
  const [quality, setQuality] = useState(-1);
  const [subtitle, setSubtitle] = useState(() => subtitles.findIndex((track) => track.default));
  const [caption, setCaption] = useState("");
  const [autoMuted, setAutoMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [picture, setPicture] = useState({ gap: 0, height: 0 });
  const controlsRef = useRef(null);
  const [hint, setHint] = useState(false);
  const [panel, setPanel] = useState(null);

  function showControls() {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 3000);
  }

  useEffect(() => { container.current?.focus(); }, []);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  // iPhone full screen uses iOS's own player, which only shows "showing" tracks.
  // A subtitle change made in its menu is kept when it closes.
  useEffect(() => {
    const video = videoRef.current;
    const begin = () => setNativeFullscreen(true);
    const end = () => {
      setSubtitle([...video.querySelectorAll("track")].findIndex((element) => element.track.mode === "showing"));
      setNativeFullscreen(false);
    };
    video.addEventListener("webkitbeginfullscreen", begin);
    video.addEventListener("webkitendfullscreen", end);
    return () => {
      video.removeEventListener("webkitbeginfullscreen", begin);
      video.removeEventListener("webkitendfullscreen", end);
    };
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    const report = () => callbacks.current.onProgress?.({
      currentTime: video.currentTime, duration: video.duration,
    });
    const interval = setInterval(() => { if (!video.paused) report(); }, 5000);
    // iOS only allows sound right after a tap, and playback starts after the
    // server replies. If play() is refused, start muted and offer to unmute.
    const tryPlay = () => {
      void video.play().catch((error) => {
        if (cancelled || error?.name !== "NotAllowedError" || video.muted) return;
        video.muted = true;
        setMuted(true);
        setAutoMuted(true);
        void video.play().catch(() => {});
      });
    };
    // MP4 plays natively. HLS goes through hls.js wherever it runs, including
    // iOS 17.1+ (Managed Media Source): the page then fetches the stream itself,
    // as on desktop. iOS's own HLS player is only the fallback.
    let native = kind !== "hls";
    const playNatively = () => {
      native = true;
      video.src = src;
      tryPlay();
    };
    if (native) playNatively();
    else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) return playNatively();
          throw new Error("HLS is unavailable in this browser");
        }
        const instance = new Hls({ startPosition: resume.current || -1 });
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
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind]);

  // A track the viewer just picked (e.g. from a subtitle search) turns on.
  useEffect(() => {
    const index = subtitles.findIndex((track) => track.picked && !seenTracks.current.has(track.src));
    for (const track of subtitles) seenTracks.current.add(track.src);
    if (index >= 0) setSubtitle(index);
  }, [subtitles]);
  // The browser loads and times the chosen track ("hidden"), and the player
  // draws the current cue itself, so it can sit above the controls.
  useEffect(() => {
    const video = videoRef.current;
    const elements = [...video.querySelectorAll("track")];
    setCaption("");
    if (nativeFullscreen) {
      // iOS draws the subtitles itself; its menu is left in charge until it closes.
      elements.forEach((element, index) => { element.track.mode = index === subtitle ? "showing" : "disabled"; });
      // iOS puts lines at the very bottom, under its seek bar. Lines without
      // their own position are lifted so they end at 80% of the screen height.
      const chosen = elements[subtitle];
      const lift = () => {
        for (const cue of chosen?.track.cues || []) {
          if (cue.line !== "auto") continue;
          cue.snapToLines = false;
          cue.line = 80;
          if ("lineAlign" in cue) cue.lineAlign = "end";
        }
      };
      lift();
      chosen?.addEventListener("load", lift);
      return () => chosen?.removeEventListener("load", lift);
    }
    // Safari picks subtitle tracks itself (by the phone's language) and can
    // switch ours off, so the chosen modes are put back whenever they change.
    const applyModes = () => elements.forEach((element, index) => {
      const mode = index === subtitle ? "hidden" : "disabled";
      if (element.track.mode !== mode) element.track.mode = mode;
    });
    applyModes();
    video.textTracks.addEventListener("change", applyModes);
    video.addEventListener("loadedmetadata", applyModes);
    const active = elements[subtitle]?.track;
    const update = () => setCaption([...(active?.activeCues || [])]
      .map((cue) => (cue.text || "").replace(/<[^>]*>/g, "").trim()).filter(Boolean).join("\n"));
    active?.addEventListener("cuechange", update);
    update();
    return () => {
      video.textTracks.removeEventListener("change", applyModes);
      video.removeEventListener("loadedmetadata", applyModes);
      active?.removeEventListener("cuechange", update);
    };
  }, [subtitle, subtitles, nativeFullscreen]);

  // Where the picture sits inside the full-screen video element (letterboxing).
  useEffect(() => {
    const video = videoRef.current;
    const measure = () => {
      const height = video.clientHeight;
      const scale = video.videoWidth && video.videoHeight
        ? Math.min(video.clientWidth / video.videoWidth, height / video.videoHeight) : 0;
      const pictureHeight = scale ? video.videoHeight * scale : height;
      setPicture({ gap: (height - pictureHeight) / 2, height: pictureHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    video.addEventListener("loadedmetadata", measure);
    video.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("resize", measure);
    };
  }, []);

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
  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else if (container.current.requestFullscreen) void container.current.requestFullscreen().catch(() => {});
    else videoRef.current.webkitEnterFullscreen?.();
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

  const subtitleMenu = subtitles.length ? [{
    id: "subtitles", label: "Subtitles",
    value: subtitle >= 0 ? subtitles[subtitle]?.label || subtitles[subtitle]?.lang : "Off",
    items: [{ key: "off", label: "Off", selected: subtitle === -1, onSelect: () => setSubtitle(-1) },
      ...subtitles.map((track, index) => ({
        key: `${track.src}-${index}`, label: track.label || track.lang || `Track ${index + 1}`,
        selected: subtitle === index, onSelect: () => setSubtitle(index),
      }))],
  }] : [];
  const qualityMenu = levels.length > 1 ? [{
    id: "quality", label: "Quality",
    value: quality === -1 ? "Auto" : `${levels[quality]?.height || quality + 1}p`,
    items: [{ key: "auto", label: "Auto", selected: quality === -1 },
      ...levels.map((level, index) => ({
        key: String(index), label: level.height ? `${level.height}p` : `Level ${index + 1}`,
        selected: quality === index,
      }))].map((item, index) => ({
      ...item,
      onSelect: () => {
        hls.current.currentLevel = index - 1;
        setQuality(index - 1);
      },
    })),
  }] : [];
  const allMenus = [...subtitleMenu, ...qualityMenu, ...menus];
  const openMenu = allMenus.find((menu) => menu.id === panel);

  function chooseRow(menu) {
    if (menu.items || menu.note || menu.extra) {
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

  function handleKey(event) {
    showControls();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { key, target } = event;
    if (key.toLowerCase() === "f" && target.tagName !== "INPUT") {
      event.preventDefault();
      fullscreen();
      return;
    }
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
      if (mapped.action === "hintExit") {
        setHint(true);
        clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), 1900);
      }
      return;
    }
    // Focus is on a control or in the Options panel.
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
    const reveal = pointerType.current === "touch" && !controls && !paused;
    showControls();
    if (!reveal) togglePlay();
  }

  const visible = controls || paused || !!panel;
  // Captions sit near the bottom of the picture, and above the controls while they show.
  const captionBottom = Math.max(picture.gap + picture.height * 0.06,
    visible ? (controlsRef.current?.offsetHeight || 0) + 12 : 16);
  const captionSize = Math.min(44, Math.max(15, (picture.height || 400) * 0.055));
  return (
    <section ref={container} className="web-player" tabIndex={0} data-web-player
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
          <track key={`${track.src}-${index}`} kind="subtitles" src={track.src} default={index === subtitle}
            srcLang={trackLanguage(track.lang)} label={track.label || track.lang || "Subtitles"} />
        ))}
      </video>
      {caption && <div className="web-player-caption" aria-live="polite"
        style={{ bottom: captionBottom, fontSize: captionSize }}><span>{caption}</span></div>}
      {overlay}
      {hint && <div className="web-player-hint" role="status">Press ↓ again to exit</div>}
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
          <span>{time(at)}</span>
          <input type="range" aria-label="Seek" data-seek min="0" max={duration || 1} step="0.1"
            value={Math.min(at, duration)} disabled={!duration}
            onChange={(event) => { videoRef.current.currentTime = Number(event.target.value); }} />
          <span>{time(duration)}</span>
        </div>
        <div className="web-player-bar">
          <button ref={playButton} className="web-player-icon web-player-icon--main" onClick={togglePlay}
            aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button className="web-player-icon" onClick={() => seek(-10)} aria-label="Back 10 seconds" title="Back 10 seconds"><SeekBackIcon /></button>
          <button className="web-player-icon" onClick={() => seek(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds"><SeekForwardIcon /></button>
          <div className="web-player-volume">
            <button className="web-player-icon" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>
              {muted ? <MutedIcon /> : <VolumeIcon />}
            </button>
            <input type="range" aria-label="Volume" tabIndex={-1} min="0" max="1" step="0.05"
              value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} />
          </div>
          <span className="web-player-spacer" />
          {onNext && <button className="web-player-pill" onClick={onNext} title="Next episode">
            <NextEpisodeIcon /><span>Next episode</span>
          </button>}
          {!!allMenus.length && <button ref={optionsButton} className="web-player-icon" aria-label="Options" title="Options"
            aria-expanded={!!panel} onClick={() => (panel ? closePanel() : setPanel("main"))}>
            <SettingsIcon />
          </button>}
          <button className="web-player-icon" onClick={fullscreen} aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            title={isFullscreen ? "Exit full screen" : "Full screen"}>
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </button>
        </div>
      </div>
      {panel && (
        <div ref={panelRef} className="web-player-panel" role="menu" aria-label={openMenu?.label || "Options"}>
          {panel === "main" || !openMenu ? allMenus.map((menu) => (
            <button key={menu.id} className="web-player-row" data-menu={menu.id} role="menuitem" onClick={() => chooseRow(menu)}>
              <span>{menu.label}</span>
              {menu.value && <span className="web-player-row-value">{menu.value}</span>}
              {(menu.items || menu.note || menu.extra) && <ChevronRightIcon size={18} />}
            </button>
          )) : <>
            <button className="web-player-row web-player-row--back" onClick={panelBack}>
              <ChevronLeftIcon size={18} /><span>{openMenu.label}</span>
            </button>
            {openMenu.status && <p className="web-player-note" role="status">{openMenu.status}</p>}
            {openMenu.items?.map((item) => {
              const content = <>
                <span className="web-player-check">{item.selected && <CheckIcon />}</span>
                <span className="web-player-row-label">{item.label}{item.detail && <small>{item.detail}</small>}</span>
              </>;
              return item.href
                ? <a key={item.key} className="web-player-row" href={item.href} role="menuitem" onClick={() => chooseItem(item)}>{content}</a>
                : <button key={item.key} className="web-player-row" role="menuitemradio" aria-checked={!!item.selected}
                  disabled={item.disabled} onClick={() => chooseItem(item)}>{content}</button>;
            })}
            {openMenu.extra}
            {openMenu.note && <p className="web-player-note">{openMenu.note}</p>}
          </>}
        </div>
      )}
    </section>
  );
}
