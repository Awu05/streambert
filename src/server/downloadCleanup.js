const DAY = 86400000;
const GB = 1024 ** 3;

function planCleanup(downloads, { days, limitGb }, { now, sizeOf, isBusy }) {
  const completed = downloads.filter(({ status }) => status === "completed");
  const available = completed.filter((download) => !isBusy(download));
  const watched = available.filter((download) => download.watchedAt != null)
    .sort((a, b) => a.watchedAt - b.watchedAt);
  const expired = days ? watched.filter((download) => download.watchedAt <= now - days * DAY) : [];
  const ids = expired.map(({ id }) => id);
  if (!limitGb) return ids;

  const sizes = new Map(completed.map((download) => [download.id, sizeOf(download)]));
  const expiredIds = new Set(ids);
  let bytes = completed.reduce((total, { id }) => total + (expiredIds.has(id) ? 0 : sizes.get(id)), 0);
  const unwatched = available.filter((download) => download.watchedAt == null)
    .sort((a, b) => (a.completedAt ?? a.startedAt ?? 0) - (b.completedAt ?? b.startedAt ?? 0));
  for (const { id } of [...watched.slice(expired.length), ...unwatched]) {
    if (bytes <= limitGb * GB) break;
    if (!sizes.get(id)) continue;
    bytes -= sizes.get(id);
    ids.push(id);
  }
  return ids;
}

function startCleanup({
  getDownloads, deleteDownload, getSettings, sizeOf, isBusy, log = console.log, intervalMs = 3600000,
}) {
  function run() {
    try {
      const now = Date.now();
      const settings = getSettings();
      const downloads = getDownloads();
      const byId = new Map(downloads.map((download) => [download.id, download]));
      for (const id of planCleanup(downloads, settings, { now, sizeOf, isBusy })) {
        const download = byId.get(id);
        if (isBusy(download)) continue;
        const result = deleteDownload(id);
        if (!result.ok) {
          console.warn("Download clean-up could not remove %s: %s", download.name, result.error);
          continue;
        }
        const age = download.watchedAt == null ? 0 : Math.floor((now - download.watchedAt) / DAY);
        const reason = settings.days && age >= settings.days ? `watched ${age} days ago` : "space limit";
        log(`Download clean-up removed ${download.name} (${reason})`);
      }
    } catch (error) {
      console.error("Download clean-up failed:", error.message);
    }
  }
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { planCleanup, startCleanup };
