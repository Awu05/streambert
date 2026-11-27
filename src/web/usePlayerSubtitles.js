import { useCallback, useEffect, useMemo, useState } from "react";

// The cue's plain text, without WebVTT markup such as <i> or <b>.
const cueText = (cue) => (cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text || "").trim();
const isCaption = (track) => track.kind === "captions" || track.kind === "subtitles";
const FILE_TRACKS = "track[data-player-subtitle]";

export function useSubtitles(videoRef, subtitles, pickedSubtitle, nativePictureInPicture, dashRef, dashTracks) {
  const [selection, setSelection] = useState(() => {
    const src = subtitles.find((track) => track.default)?.src ?? null;
    return { active: src, last: src };
  });
  const [embedded, setEmbedded] = useState([]);
  const [caption, setCaption] = useState("");
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const selectTrack = useCallback((src) => {
    setSelection((previous) => previous.active === src ? previous : { active: src, last: src ?? previous.last });
  }, []);

  const tracks = useMemo(() => [
    ...subtitles.map((track, index) => ({
      id: track.src,
      key: `file-${index}`,
      label: track.label || track.lang || `Track ${index + 1}`,
      default: track.default,
    })),
    ...embedded.map((track, index) => ({
      id: track,
      key: `embedded-${index}`,
      label: track.label || track.language || `Track ${subtitles.length + index + 1}`,
    })),
  ], [subtitles, embedded]);
  const selected = tracks.find((track) => track.id === selection.active);

  useEffect(() => {
    if (pickedSubtitle) selectTrack(pickedSubtitle.src);
  }, [pickedSubtitle, selectTrack]);

  useEffect(() => {
    const video = videoRef.current;
    const textTracks = video.textTracks;
    function update() {
      const files = new Set(Array.from(video.querySelectorAll(FILE_TRACKS), (element) => element.track));
      const next = Array.from(textTracks).filter((track) => isCaption(track) && !files.has(track));
      setEmbedded((previous) => next.length === previous.length && next.every((track, index) => track === previous[index])
        ? previous : next);
    }

    update();
    textTracks.addEventListener("addtrack", update);
    textTracks.addEventListener("removetrack", update);
    return () => {
      textTracks.removeEventListener("addtrack", update);
      textTracks.removeEventListener("removetrack", update);
    };
  }, [videoRef]);

  // iOS full screen: keep whatever is chosen in its menu when it closes.
  useEffect(() => {
    const video = videoRef.current;
    const begin = () => setNativeFullscreen(true);
    const end = () => {
      const track = Array.from(video.textTracks).find((entry) => isCaption(entry) && entry.mode === "showing");
      const file = Array.from(video.querySelectorAll(FILE_TRACKS)).find((element) => element.track === track);
      selectTrack(file?.getAttribute("src") ?? track ?? null);
      setNativeFullscreen(false);
    };
    video.addEventListener("webkitbeginfullscreen", begin);
    video.addEventListener("webkitendfullscreen", end);
    return () => {
      video.removeEventListener("webkitbeginfullscreen", begin);
      video.removeEventListener("webkitendfullscreen", end);
    };
  }, [videoRef, selectTrack]);

  useEffect(() => {
    const video = videoRef.current;
    const textTracks = Array.from(video.textTracks).filter(isCaption);
    const file = typeof selection.active === "string"
      ? Array.from(video.querySelectorAll(FILE_TRACKS)).find((element) => element.getAttribute("src") === selection.active)
      : null;
    const chosen = typeof selection.active === "string" ? file?.track : selection.active;
    const dash = dashRef.current;
    if (dash && dashTracks.length) {
      const index = chosen ? dashTracks.indexOf(chosen) : -1;
      if (dash.getCurrentTextTrackIndex() !== index) dash.setTextTrack(index);
    }
    const showing = nativeFullscreen || nativePictureInPicture;
    const selectedMode = showing ? "showing" : "hidden";
    const applyModes = () => textTracks.forEach((track) => {
      const mode = track === chosen ? selectedMode : "disabled";
      if (track.mode !== mode) track.mode = mode;
    });
    applyModes();

    if (nativeFullscreen) {
      setCaption("");
      // Leave space for the native seek bar.
      const lift = () => {
        for (const cue of chosen?.cues || []) {
          if (cue.line !== "auto") continue;
          cue.snapToLines = false;
          cue.line = 80;
          if ("lineAlign" in cue) cue.lineAlign = "end";
        }
      };
      lift();
      file?.addEventListener("load", lift);
      chosen?.addEventListener("cuechange", lift);
      return () => {
        file?.removeEventListener("load", lift);
        chosen?.removeEventListener("cuechange", lift);
      };
    }

    const update = () => setCaption(showing ? "" : Array.from(chosen?.activeCues || [], cueText).filter(Boolean).join("\n"));
    update();
    video.textTracks.addEventListener("change", applyModes);
    video.addEventListener("loadedmetadata", applyModes);
    chosen?.addEventListener("cuechange", update);
    return () => {
      video.textTracks.removeEventListener("change", applyModes);
      video.removeEventListener("loadedmetadata", applyModes);
      chosen?.removeEventListener("cuechange", update);
    };
  }, [videoRef, selection.active, subtitles, embedded, nativeFullscreen, nativePictureInPicture, dashRef, dashTracks]);

  function toggleSubtitles() {
    if (selected) {
      selectTrack(null);
      return;
    }
    const track = tracks.find(({ id }) => id === selection.last)
      ?? tracks.find((track) => track.default)
      ?? tracks[0];
    selectTrack(track?.id ?? null);
  }

  return { tracks, selected, selectTrack, toggleSubtitles, caption };
}

/** The picture's height inside the video element and the letterbox gap below it. */
export function usePictureBox(videoRef) {
  const [box, setBox] = useState({ gap: 0, height: 0 });
  useEffect(() => {
    const video = videoRef.current;
    const measure = () => {
      const height = video.clientHeight;
      const scale = video.videoWidth && video.videoHeight
        ? Math.min(video.clientWidth / video.videoWidth, height / video.videoHeight) : 0;
      const pictureHeight = scale ? video.videoHeight * scale : height;
      setBox({ gap: (height - pictureHeight) / 2, height: pictureHeight });
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
  }, [videoRef]);
  return box;
}
