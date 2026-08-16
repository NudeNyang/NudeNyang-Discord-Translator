const MIN_THUMB_HEIGHT = 32;

function finitePositive(value) {
  return Math.max(0, Number(value) || 0);
}

export function pageScrollThumbMetrics(trackHeight, viewportHeight, scrollHeight, scrollTop) {
  const track = finitePositive(trackHeight);
  const viewport = finitePositive(viewportHeight);
  const content = finitePositive(scrollHeight);
  const maxScroll = Math.max(0, content - viewport);
  if (track <= 0 || viewport <= 0 || maxScroll <= 0) {
    return { scrollable: false, height: 0, top: 0 };
  }

  const height = Math.min(track, Math.max(MIN_THUMB_HEIGHT, (track * viewport) / content));
  const progress = Math.min(1, Math.max(0, finitePositive(scrollTop) / maxScroll));
  return {
    scrollable: true,
    height,
    top: progress * Math.max(0, track - height),
  };
}

export function pageScrollTopFromPointer(pointerY, trackTop, trackHeight, thumbHeight, maxScroll) {
  const travel = Math.max(0, finitePositive(trackHeight) - finitePositive(thumbHeight));
  const scrollLimit = finitePositive(maxScroll);
  if (travel <= 0 || scrollLimit <= 0) return 0;

  const thumbTop = Math.min(
    travel,
    Math.max(0, (Number(pointerY) || 0) - (Number(trackTop) || 0) - finitePositive(thumbHeight) / 2),
  );
  return (thumbTop / travel) * scrollLimit;
}
