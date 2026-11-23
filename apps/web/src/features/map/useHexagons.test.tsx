// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalculationResults } from '../../models/types.ts';
import { LEGEND } from '../../shared/test-support.ts';
import { prepare, type PrepareRequest } from './hexagons.ts';
import { useHexagons } from './useHexagons.ts';

const parent = cellToParent(latLngToCell(54.687, 25.28, 9), 8);
const results = (calculationId: string): CalculationResults => ({
  calculationId,
  resolution: 9,
  cells: cellToChildren(parent, 9).map((h3, i) => ({
    h3,
    transitS: 600 + i * 60,
    carS: 600,
    ratio: (600 + i * 60) / 600,
    class: 'good',
  })),
});

/** A worker that answers when told to, so the test decides the order of the answers. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  readonly requests: PrepareRequest[] = [];
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  postMessage(request: PrepareRequest) {
    this.requests.push(request);
  }
  answer(index: number) {
    const request = this.requests[index] as PrepareRequest;
    this.dispatchEvent(new MessageEvent('message', { data: { id: request.id, data: prepare(request) } }));
  }
  terminate = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe('useHexagons', () => {
  it('prepares on the main thread where there is no Worker', async () => {
    const r = results('a');
    const { result } = renderHook(() => useHexagons(r, 8, LEGEND));
    await waitFor(() => expect(result.current?.features).toHaveLength(1));
    expect(result.current?.features[0]?.properties.count).toBe(7);
  });

  it('prepares in the worker, keeps each resolution and ignores answers that came too late', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const first = results('a');
    const { result, rerender } = renderHook(({ r, res }) => useHexagons(r, res, LEGEND), {
      initialProps: { r: first, res: 9 },
    });
    expect(result.current).toBeUndefined(); // being prepared
    const worker = FakeWorker.instances[0] as FakeWorker;
    act(() => worker.answer(0));
    await waitFor(() => expect(result.current?.features).toHaveLength(7));

    // Zoom out, then back in: resolution 9 comes from the cache, without a new request.
    rerender({ r: first, res: 8 });
    act(() => worker.answer(1));
    await waitFor(() => expect(result.current?.features).toHaveLength(1));
    rerender({ r: first, res: 9 });
    expect(result.current?.features).toHaveLength(7);
    expect(worker.requests).toHaveLength(2);

    // New results arrive while the previous ones are still being prepared: the late answer
    // for the previous results is dropped, the answer for the new ones is drawn.
    rerender({ r: results('b'), res: 8 }); // request 2
    rerender({ r: results('c'), res: 9 }); // request 3
    expect(result.current).toBeUndefined();
    act(() => worker.answer(2));
    expect(result.current).toBeUndefined();
    act(() => worker.answer(3));
    await waitFor(() => expect(result.current?.features).toHaveLength(7));
    expect(FakeWorker.instances).toHaveLength(1); // one worker for the whole map
  });

  it('falls back to the main thread when the worker fails, also for later jobs', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const r = results('a');
    const { result, rerender } = renderHook(({ res }) => useHexagons(r, res, LEGEND), { initialProps: { res: 9 } });
    const worker = FakeWorker.instances[0] as FakeWorker;
    act(() => {
      worker.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(result.current?.features).toHaveLength(7));
    expect(worker.terminate).toHaveBeenCalled();

    // Zooming out after the failure: prepared in place, no new worker, no job for the dead one.
    rerender({ res: 8 });
    await waitFor(() => expect(result.current?.features).toHaveLength(1));
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.requests).toHaveLength(1);
  });
});
