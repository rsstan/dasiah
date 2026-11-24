// Display helpers of the map that need no H3 code, so the map component can use them without
// loading h3-js on the main thread (the polygons are built in hexagons.worker.ts).

/** H3 resolution drawn at a zoom level, never finer than the data. */
export function resolutionForZoom(zoom: number, dataResolution: number): number {
  const wanted = zoom < 10 ? 7 : zoom <= 12 ? 8 : 9;
  return Math.min(wanted, dataResolution);
}

/** "1 h 05 min", "23 min", "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return '—';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
