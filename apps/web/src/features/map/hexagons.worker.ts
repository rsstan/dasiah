// Web Worker: turns result cells into the polygons the map draws (merging into parent cells when
// zoomed out). For a city of ~5 000 cells this is tens of milliseconds of h3 work that would
// otherwise block the main thread while the map is being panned.
import { prepare, type PrepareRequest } from './hexagons.ts';

self.onmessage = (event: MessageEvent<PrepareRequest>) => {
  self.postMessage({ id: event.data.id, data: prepare(event.data) });
};
