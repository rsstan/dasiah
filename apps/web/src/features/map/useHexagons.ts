// The polygons for the map, prepared in a Web Worker (hexagons.worker.ts) so the page stays
// responsive. Prepared collections are kept per resolution for the current results, so zooming
// back and forth does not prepare them again; an answer for older results or another
// resolution is ignored. Where Worker is missing (tests in jsdom) or fails, the work runs on the
// main thread; the H3 code is then loaded on demand, so normally only the worker loads it.
import { useEffect, useRef, useState } from 'react';
import type { CalculationResults, LegendClass } from '../../models/types.ts';
import { logger } from '../../shared/lib/logger.ts';
import type { CellCollection, PrepareRequest } from './hexagons.ts';

interface Answer {
  id: number;
  data: CellCollection;
}

/** The collection for `results` at `resolution`; undefined while it is being prepared. */
export function useHexagons(
  results: CalculationResults | undefined,
  resolution: number | undefined,
  legend: readonly LegendClass[],
): CellCollection | undefined {
  const worker = useRef<Worker | undefined>(undefined);
  /** Set once the worker failed: from then on every job runs on the main thread. */
  const broken = useRef(false);
  const nextId = useRef(0);
  // Prepared collections of the current results and legend, by resolution.
  const [cache, setCache] = useState<{
    results: CalculationResults | undefined;
    legend: readonly LegendClass[];
    byResolution: ReadonlyMap<number, CellCollection>;
  }>({ results: undefined, legend, byResolution: new Map() });

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = undefined;
    },
    [],
  );

  const current = cache.results === results && cache.legend === legend;
  const ready = current && resolution !== undefined ? cache.byResolution.get(resolution) : undefined;

  useEffect(() => {
    if (results === undefined || resolution === undefined || ready !== undefined) {
      return;
    }
    // False once the inputs change: a result prepared on the main thread for older inputs is dropped.
    let active = true;
    const store = (data: CellCollection) => {
      if (!active) {
        return;
      }
      setCache((old) => {
        const byResolution = new Map(old.results === results && old.legend === legend ? old.byResolution : []);
        byResolution.set(resolution, data);
        return { results, legend, byResolution };
      });
    };

    const inPlace = () =>
      void import('./hexagons.ts').then(({ prepare }) => store(prepare({ cells: results.cells, resolution, legend })));

    if (typeof Worker === 'undefined' || broken.current) {
      inPlace();
      return () => {
        active = false;
      };
    }
    worker.current ??= new Worker(new URL('./hexagons.worker.ts', import.meta.url), { type: 'module' });
    const id = ++nextId.current;
    const target = worker.current;
    const onAnswer = (event: MessageEvent<Answer>) => {
      if (event.data.id === id) {
        store(event.data.data);
      }
    };
    // A worker that cannot start or fails does not answer any later job either: drop it and do
    // the work here rather than never drawing.
    const onFailure = (event: Event) => {
      logger.warn('hexagon worker failed; preparing on the main thread', {
        error: event instanceof ErrorEvent ? event.message : event.type,
      });
      broken.current = true;
      target.terminate();
      worker.current = undefined;
      inPlace();
    };
    target.addEventListener('message', onAnswer);
    target.addEventListener('error', onFailure);
    target.addEventListener('messageerror', onFailure);
    const request: PrepareRequest = { id, cells: results.cells, resolution, legend };
    target.postMessage(request);
    return () => {
      active = false;
      target.removeEventListener('message', onAnswer);
      target.removeEventListener('error', onFailure);
      target.removeEventListener('messageerror', onFailure);
    };
  }, [results, resolution, legend, ready]);

  return ready;
}
