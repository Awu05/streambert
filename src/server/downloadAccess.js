const fs = require("node:fs");
const { MAIN_ID } = require("./profiles");

const ownerOf = (download) => download.profileId || MAIN_ID;
const canAccess = (download, profile) => Boolean(download && profile && !profile.kids &&
  (profile.main || ownerOf(download) === profile.id));

function sizeOf(download) {
  try {
    const stat = fs.statSync(download.filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function visibleDownloads(all, profile, profiles) {
  const visible = all.filter((download) => canAccess(download, profile));
  if (!profile.main) return visible;
  return visible.map((download) => {
    const owner = profiles?.get(ownerOf(download));
    return { ...download, ownerName: owner?.name, ownerColor: owner?.color, sizeBytes: sizeOf(download) };
  });
}

function downloadKey({ tmdbId, mediaType, season, episode }) {
  if (tmdbId == null) return null;
  if (mediaType === "movie") return `movie_${tmdbId}`;
  if (mediaType === "tv" && season != null && episode != null) return `tv_${tmdbId}_s${season}e${episode}`;
  return null;
}

function stampWatched(all, profileId, { watched, unwatched }, now) {
  const added = new Set(watched);
  const removed = new Set(unwatched);
  const changes = [];
  if (!added.size && !removed.size) return changes;
  for (const download of all) {
    if (ownerOf(download) !== profileId) continue;
    const key = downloadKey(download);
    if (added.has(key) && download.watchedAt == null) {
      changes.push({ id: download.id, patch: { watchedAt: now } });
    } else if (removed.has(key) && download.watchedAt != null) {
      changes.push({ id: download.id, patch: { watchedAt: null } });
    }
  }
  return changes;
}

module.exports = { ownerOf, canAccess, sizeOf, visibleDownloads, downloadKey, stampWatched };
