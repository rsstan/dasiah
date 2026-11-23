import type { LegendClass } from '../../models/types.ts';

export function Legend({ classes }: { classes: readonly LegendClass[] }) {
  const sorted = [...classes].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <section className="legend" aria-label="Legend">
      <h2>Transit time ÷ car time</h2>
      <ul>
        {sorted.map((c) => (
          <li key={c.code}>
            <span className="swatch" style={{ background: c.color }} aria-hidden="true" />
            <span className="range">{range(c)}</span>
            <span className="label">{c.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function range(c: LegendClass): string {
  if (c.minRatio === null) {
    return '';
  }
  return c.maxRatio === null ? `≥ ${c.minRatio.toFixed(1)}` : `${c.minRatio.toFixed(1)}–${c.maxRatio.toFixed(1)}`;
}
