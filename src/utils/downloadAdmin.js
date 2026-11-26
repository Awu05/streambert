const ownerOf = (download) => download.profileId || "default";

export function groupByOwner(downloads) {
  const groups = new Map();
  for (const download of downloads) {
    const ownerId = ownerOf(download);
    if (!groups.has(ownerId)) {
      groups.set(ownerId, { ownerId, ownerName: download.ownerName, ownerColor: download.ownerColor, count: 0, bytes: 0 });
    }
    const group = groups.get(ownerId);
    group.count++;
    group.bytes += download.sizeBytes ?? 0;
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

export function filterByOwner(downloads, ownerId) {
  return ownerId === "all" ? downloads : downloads.filter((download) => ownerOf(download) === ownerId);
}

export function sortDownloads(downloads, by, direction) {
  const value = by === "size" ? (download) => download.sizeBytes ?? 0 :
    (download) => download.completedAt ?? download.startedAt ?? 0;
  const order = direction === "desc" ? -1 : 1;
  return [...downloads].sort((a, b) => order * (value(a) - value(b)));
}
