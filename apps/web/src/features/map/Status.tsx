import { useEffect, useState } from 'react';
import type { CalculationState } from './api/useCalculation.ts';
import { Button } from '../../shared/ui/index.ts';

interface Props {
  state: CalculationState;
  onRetry: () => void;
}

export function Status({ state, onRetry }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.kind !== 'running') {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [state.kind]);

  switch (state.kind) {
    case 'idle':
      return <p className="status">Choose a start address to see the map.</p>;
    case 'running':
      return (
        <p className="status running" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Computing travel times… {Math.max(0, Math.round((now - state.startedAt) / 1000))} s
        </p>
      );
    case 'done': {
      const { calculation, cached } = state;
      return (
        <p className="status done" role="status">
          Departure {calculation.date} at {calculation.time}
          {calculation.windowMinutes > 0 ? `, ${calculation.windowMinutes}-min window` : ''} ·{' '}
          {calculation.cellCount?.toLocaleString('en') ?? 0} cells ·{' '}
          {cached ? 'from cache' : `computed in ${((calculation.durationMs ?? 0) / 1000).toFixed(1)} s`}
        </p>
      );
    }
    case 'error':
      return (
        <div className="status error" role="alert">
          <p>{state.message}</p>
          {state.correlationId !== undefined && <p className="reference">Reference: {state.correlationId}</p>}
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
  }
}
