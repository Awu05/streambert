import { storage } from "./storage";

export function recordProgress({ currentTime, duration }, {
  progressKey, saveProgress, markWatched, watchedThreshold, alreadyMarked,
}) {
  if (!Number.isFinite(duration) || duration <= 0 ||
    !Number.isFinite(currentTime) || currentTime <= 0) return;
  saveProgress?.(progressKey, Math.min(100, Math.floor(currentTime / duration * 100)));
  storage.set("dlTime_" + progressKey, Math.floor(currentTime));
  if (!alreadyMarked.current && duration - currentTime <= watchedThreshold) {
    alreadyMarked.current = true;
    markWatched?.(progressKey);
  }
}
