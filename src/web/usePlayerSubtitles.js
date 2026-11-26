import { useEffect, useRef, useState } from "react";

const cueText = (cue) => (cue.text || "").replace(/<[^>]*>/g, "").trim();

/**
 * The chosen subtitle track and its current line. The browser loads and times
 * the track ("hidden" mode) and the player draws the line, so it can sit above
 * the controls. In iPhone full screen, iOS's own player shows the track instead.
 */
export function useSubtitles(videoRef, subtitles) {
  const [subtitle, setSubtitle] = useState(() => subtitles.findIndex((track) => track.default));
  const [caption, setCaption] = useState("");
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const seen = useRef(new Set(subtitles.map((track) => track.src)));

  // A newly added track marked `picked` (from a subtitle search) turns on.
  useEffect(() => {
    const index = subtitles.findIndex((track) => track.picked && !seen.current.has(track.src));
    for (const track of subtitles) seen.current.add(track.src);
    if (index >= 0) setSubtitle(index);
  }, [subtitles]);

  // iOS full screen: keep whatever is chosen in its menu when it closes.
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
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    const elements = [...video.querySelectorAll("track")];
    const chosen = elements[subtitle];
    setCaption("");

    if (nativeFullscreen) {
      elements.forEach((element, index) => { element.track.mode = index === subtitle ? "showing" : "disabled"; });
      // iOS puts lines under its seek bar; lift unpositioned lines to end at 80% height.
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

    // Safari may switch tracks itself (by the phone's language), so modes are reapplied.
    const applyModes = () => elements.forEach((element, index) => {
      const mode = index === subtitle ? "hidden" : "disabled";
      if (element.track.mode !== mode) element.track.mode = mode;
    });
    const update = () => setCaption([...(chosen?.track.activeCues || [])].map(cueText).filter(Boolean).join("\n"));
    applyModes();
    update();
    video.textTracks.addEventListener("change", applyModes);
    video.addEventListener("loadedmetadata", applyModes);
    chosen?.track.addEventListener("cuechange", update);
    return () => {
      video.textTracks.removeEventListener("change", applyModes);
      video.removeEventListener("loadedmetadata", applyModes);
      chosen?.track.removeEventListener("cuechange", update);
    };
  }, [videoRef, subtitle, subtitles, nativeFullscreen]);

  return { subtitle, setSubtitle, caption };
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
