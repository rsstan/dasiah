// How the cells of the current map split over the legend classes: one horizontal bar per class,
// in legend order and legend colour (the same as on the map). Each row says its numbers in text
// ("640 · 12 %"), which is what screen readers read; the bar itself is hidden from them. The
// numbers are written next to every bar also because the pale classes (yellow, light green) are
// too light to be read by colour alone on a white panel.
import { memo, useMemo } from 'react';
import type { CalculationResults, LegendClass } from '../../models/types.ts';
import { classShares, formatShare } from './classes.ts';

interface Props {
  results: CalculationResults;
  legend: readonly LegendClass[];
}

export const ClassChart = memo(function ClassChart({ results, legend }: Props) {
  const shares = useMemo(() => classShares(results.cells, legend), [results, legend]);
  const total = results.cells.length;
  const largest = Math.max(...shares.map((s) => s.share), 0);
  return (
    <figure className="class-chart" aria-labelledby="class-chart-title">
      <figcaption>
        <h2 id="class-chart-title">This map by class</h2>
        <span className="hint">{total.toLocaleString('en')} cells</span>
      </figcaption>
      <ol>
        {shares.map(({ cls, count, share }) => (
          <li key={cls.code}>
            <span className="name">{cls.label}</span>
            <span className="value">
              {count.toLocaleString('en')} · {formatShare(share)}
            </span>
            {/* Bars scaled to the largest class, so small shares stay visible. */}
            <svg className="bar" width="100%" height="8" aria-hidden="true" focusable="false">
              <title>{`${cls.label}: ${count.toLocaleString('en')} cells (${formatShare(share)})`}</title>
              <rect className="track" width="100%" height="8" rx="4" />
              {count > 0 && (
                <rect
                  className="fill"
                  width={`${Math.max(1, (share / (largest || 1)) * 100)}%`}
                  height="8"
                  rx="4"
                  fill={cls.color}
                />
              )}
            </svg>
          </li>
        ))}
      </ol>
    </figure>
  );
});
