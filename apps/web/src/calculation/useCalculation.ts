import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../api/client.ts';
import type { CalculationRequest } from '../api/types.ts';
import { runCalculation, type Outcome } from './run.ts';

export type CalculationState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | ({ kind: 'done' } & Outcome)
  | { kind: 'error'; message: string; correlationId: string | undefined };

/** Runs one calculation at a time; a new request cancels the previous one. */
export function useCalculation() {
  const [state, setState] = useState<CalculationState>({ kind: 'idle' });
  const current = useRef<AbortController | undefined>(undefined);

  const run = useCallback(async (input: CalculationRequest) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setState({ kind: 'running', startedAt: Date.now() });
    try {
      const outcome = await runCalculation(input, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setState({ kind: 'done', ...outcome });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setState({
        kind: 'error',
        message: describeError(error),
        correlationId: error instanceof ApiError && error.correlationId !== '' ? error.correlationId : undefined,
      });
    }
  }, []);

  const reset = useCallback(() => {
    current.current?.abort();
    setState({ kind: 'idle' });
  }, []);

  useEffect(() => () => current.current?.abort(), []);
  return { state, run, reset };
}
