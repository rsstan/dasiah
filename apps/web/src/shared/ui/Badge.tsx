import type { ReactNode } from 'react';
import './Badge.css';

export type BadgeTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

/** A short status label. */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}
