import './Skeleton.css';

/** Placeholder shapes while data loads (announced once as "Loading"). */
export function Skeleton({ lines = 3, variant = 'text' }: { lines?: number; variant?: 'text' | 'card' }) {
  return (
    <div className={`ui-skeleton ui-skeleton--${variant}`} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ui-skeleton__line" />
      ))}
    </div>
  );
}
