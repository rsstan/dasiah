import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../../shared/api/client.ts';
import type { CalculationRequest } from '../../../models/types.ts';
import { loadCalculation, runCalculation, type Outcome } from './run.ts';

export type CalculationState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | ({ kind: 'done' } & Outcome)
  | { kind: 'error'; message: string; correlationId: string | undefined };

/** Runs one calculation at a time; a new request cancels the previous one. */
export function useCalculation() {
  const [state, setState] = useState<CalculationState>({ kind: 'idle' });
  const current = useRef<AbortController | undefined>(undefined);

  /**
   * Computes a map (`input`), or opens an existing one (`open`: calculation id) and, if it has
   * expired, computes `input` instead.
   */
  const run = useCallback(async (input: CalculationRequest, open?: string): Promise<Outcome | undefined> => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setState({ kind: 'running', startedAt: Date.now() });
    try {
      const signal = controller.signal;
      const outcome =
        open === undefined
          ? await runCalculation(input, { signal })
          : await loadCalculation(open, { signal }).catch((error: unknown) => {
              if (error instanceof ApiError && error.status === 404) {
                return runCalculation(input, { signal });
              }
              throw error;
            });
      if (!controller.signal.aborted) {
        setState({ kind: 'done', ...outcome });
        return outcome;
      }
      return undefined;
    } catch (error) {
      if (controller.signal.aborted) {
        return undefined;
      }
      setState({
        kind: 'error',
        message: describeError(error),
        correlationId: error instanceof ApiError && error.correlationId !== '' ? error.correlationId : undefined,
      });
      return undefined;
    }
  }, []);

  const reset = useCallback(() => {
    current.current?.abort();
    setState({ kind: 'idle' });
  }, []);

  useEffect(() => () => current.current?.abort(), []);
  return { state, run, reset };
}
