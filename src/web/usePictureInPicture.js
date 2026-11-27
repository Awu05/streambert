import { useEffect, useRef, useState } from "react";

const PICTURE_IN_PICTURE = "picture-in-picture";
const EVENTS = [
  "loadedmetadata", "emptied", "resize",
  "enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged",
];

function entryMode(video) {
  if (!video.readyState || !video.videoWidth || video.disablePictureInPicture) return null;
  if (window === window.top && window.documentPictureInPicture?.requestWindow) return "document";
  const webKitSupported = video.webkitSupportsPresentationMode?.(PICTURE_IN_PICTURE);
  if (webKitSupported === false) return null;
  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") return "standard";
  if (webKitSupported && typeof video.webkitSetPresentationMode === "function") return "webkit";
  return null;
}

function isNativeActive(video) {
  return document.pictureInPictureElement === video || video.webkitPresentationMode === PICTURE_IN_PICTURE;
}

async function exitNative(video) {
  if (document.pictureInPictureElement === video) return document.exitPictureInPicture();
  if (video.webkitPresentationMode === PICTURE_IN_PICTURE) video.webkitSetPresentationMode("inline");
}

function copyStyles(target) {
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = node.cloneNode(true);
    if (node.href) copy.href = node.href;
    target.head.append(copy);
  }
}

export function usePictureInPicture(videoRef, host, home) {
  const [state, setState] = useState(null);
  const [floating, setFloating] = useState(false);
  const floatingWindow = useRef(null);
  const opening = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    function update() {
      setState(isNativeActive(video) ? "active" : entryMode(video));
    }

    update();
    for (const event of EVENTS) video.addEventListener(event, update);
    return () => {
      for (const event of EVENTS) video.removeEventListener(event, update);
      floatingWindow.current?.close();
      void exitNative(video).catch(() => {});
    };
  }, [videoRef]);

  async function openFloating(video) {
    const popup = await window.documentPictureInPicture.requestWindow({
      width: 520,
      height: Math.round(520 * video.videoHeight / video.videoWidth),
    });
    if (!home.current?.contains(host)) {
      popup.close();
      return false;
    }
    floatingWindow.current = popup;
    popup.addEventListener("pagehide", () => {
      floatingWindow.current = null;
      if (!home.current?.isConnected) return;
      home.current.append(host);
      setFloating(false);
    }, { once: true });
    try {
      copyStyles(popup.document);
      popup.document.body.append(host);
      setFloating(true);
      return true;
    } catch (error) {
      popup.close();
      throw error;
    }
  }

  async function toggle() {
    if (opening.current) return true;
    opening.current = true;
    const video = videoRef.current;
    try {
      if (floatingWindow.current) {
        floatingWindow.current.close();
        return true;
      }
      if (isNativeActive(video)) {
        await exitNative(video);
        return true;
      }
      const mode = entryMode(video);
      if (!mode) return false;
      if (mode === "document") return await openFloating(video);
      if (mode === "standard") await video.requestPictureInPicture();
      else video.webkitSetPresentationMode(PICTURE_IN_PICTURE);
      if (!video.isConnected) await exitNative(video);
      return true;
    } catch {
      return false;
    } finally {
      opening.current = false;
    }
  }

  const native = state === "active";
  return { active: native || floating, available: state !== null || floating, native, floating, toggle };
}
