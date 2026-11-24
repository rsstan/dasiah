// One map request: POST /calculations; on 202 (the same question is being computed by another
// request) poll GET /calculations/{id}; then GET .../results. A failed calculation becomes an
// ApiError with a readable message.
import { ApiError, request } from '../../../shared/api/client.ts';
import type { Calculation, CalculationRequest, CalculationResults } from '../../../models/types.ts';

export interface Outcome {
  calculation: Calculation;
  results: CalculationResults;
  /** true when the map came from the cache (200), false when computed now (201) or awaited (202). */
  cached: boolean;
}

const FAILURES: Record<string, string> = {
  osrm_unavailable: 'Car routing is unavailable right now, so the map cannot be computed.',
  timetable_unavailable: 'The timetable for this date is not loaded.',
  busy: 'The server is busy. Try again in a minute.',
  internal_error: 'The calculation failed.',
};

export interface RunOptions {
  signal?: AbortSignal;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** Results of an existing calculation (history). 404 when it has expired and was removed. */
export async function loadCalculation(calculationId: string, options: RunOptions = {}): Promise<Outcome> {
  const { signal } = options;
  const opts = signal === undefined ? {} : { signal };
  let calculation = (await request<Calculation>(`/calculations/${calculationId}`, opts)).body;
  const started = Date.now();
  while (calculation.status === 'running' && Date.now() - started < (options.maxWaitMs ?? 90_000)) {
    await sleep(options.pollIntervalMs ?? 1_000, signal);
    calculation = (await request<Calculation>(`/calculations/${calculationId}`, opts)).body;
  }
  if (calculation.status !== 'done') {
    throw new ApiError(404, { title: 'This map is no longer available.' }, '');
  }
  const results = await request<CalculationResults>(`/calculations/${calculationId}/results`, opts);
  return { calculation, results: results.body, cached: true };
}

export async function runCalculation(input: CalculationRequest, options: RunOptions = {}): Promise<Outcome> {
  const { signal, pollIntervalMs = 1_000, maxWaitMs = 90_000 } = options;
  const created = await request<Calculation>('/calculations', {
    method: 'POST',
    body: input,
    ...(signal === undefined ? {} : { signal }),
  });
  let calculation = created.body;
  const started = Date.now();
  while (calculation.status === 'running') {
    if (Date.now() - started > maxWaitMs) {
      throw new ApiError(504, { title: 'The map is taking too long. Try again later.' }, '');
    }
    await sleep(pollIntervalMs, signal);
    calculation = (
      await request<Calculation>(`/calculations/${calculation.calculationId}`, signal === undefined ? {} : { signal })
    ).body;
  }
  if (calculation.status === 'failed') {
    const code = calculation.errorCode ?? 'internal_error';
    throw new ApiError(503, { title: FAILURES[code] ?? FAILURES['internal_error'] }, '');
  }
  const results = await request<CalculationResults>(
    `/calculations/${calculation.calculationId}/results`,
    signal === undefined ? {} : { signal },
  );
  return { calculation, results: results.body, cached: created.status === 200 };
}
