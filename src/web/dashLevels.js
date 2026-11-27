export function dashLevels(representations) {
  return representations.map(({ height, bandwidth }, index) => ({ index, height, bitrate: bandwidth }))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
}
