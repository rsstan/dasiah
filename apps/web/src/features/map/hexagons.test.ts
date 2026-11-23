import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import type { CellResult } from '../../models/types.ts';
import { LEGEND } from '../../shared/test-support.ts';
import { aggregate, classify, formatDuration, median, resolutionForZoom, toFeatureCollection } from './hexagons.ts';

const parent = cellToParent(latLngToCell(54.687, 25.28, 9), 8);
const children = cellToChildren(parent, 9);

const cell = (h3: string, transitS: number | null, carS: number | null, cls?: CellResult['class']): CellResult => {
  const ratio = transitS !== null && carS !== null ? Math.round((transitS / carS) * 100) / 100 : null;
  return { h3, transitS, carS, ratio, class: cls ?? (ratio === null ? 'unreachable' : classify(ratio, LEGEND)) };
};

describe('zoom levels', () => {
  it('draws resolution 7 below zoom 10, 8 up to 12, 9 above, never finer than the data', () => {
    expect([5, 9.9, 10, 12, 12.1, 16].map((z) => resolutionForZoom(z, 9))).toEqual([7, 7, 8, 8, 9, 9]);
    expect(resolutionForZoom(15, 8)).toBe(8);
  });
});

describe('classify', () => {
  it('uses inclusive lower and exclusive upper bounds', () => {
    expect(classify(1.19, LEGEND)).toBe('excellent');
    expect(classify(1.2, LEGEND)).toBe('good');
    expect(classify(2.99, LEGEND)).toBe('poor');
    expect(classify(3, LEGEND)).toBe('very_poor');
    expect(classify(40, LEGEND)).toBe('very_poor');
  });
});

describe('aggregate', () => {
  it('keeps cells as they are at their own resolution', () => {
    const cells = [cell(children[0] as string, 600, 600)];
    expect(aggregate(cells, 9, LEGEND)).toEqual([{ ...cells[0], count: 1 }]);
  });

  it('merges children into the parent with median ratio and times', () => {
    const cells = [
      cell(children[0] as string, 600, 600), // 1.00
      cell(children[1] as string, 1500, 1000), // 1.50
      cell(children[2] as string, 2100, 1000), // 2.10
      cell(children[3] as string, null, 900), // unreachable, ignored by the medians of ratio and transit
      cell(children[4] as string, 1300, 1000, 'no_transit'), // 1.30
    ];
    expect(aggregate(cells, 8, LEGEND)).toEqual([
      { h3: parent, ratio: 1.4, class: 'good', transitS: 1400, carS: 1000, count: 5 },
    ]);
  });

  it('gives a parent without values the most common special class', () => {
    const cells = [
      cell(children[0] as string, null, 600, 'no_transit'),
      cell(children[1] as string, null, 600, 'no_transit'),
      cell(children[2] as string, null, 600, 'unreachable'),
    ];
    expect(aggregate(cells, 8, LEGEND)[0]).toMatchObject({ class: 'no_transit', ratio: null, transitS: null });
  });
});

describe('features', () => {
  it('builds closed [lon, lat] rings coloured by class', () => {
    const fc = toFeatureCollection(aggregate([cell(children[0] as string, 600, 600)], 9, LEGEND), LEGEND);
    const ring = fc.features[0]?.geometry.coordinates[0] ?? [];
    expect(ring.length).toBe(7);
    expect(ring[0]).toEqual(ring[6]);
    expect(ring[0]?.[0]).toBeCloseTo(25.28, 1);
    expect(ring[0]?.[1]).toBeCloseTo(54.687, 1);
    expect(fc.features[0]?.properties.color).toBe('#1a9850');
  });
});

describe('helpers', () => {
  it('median and durations', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect([null, undefined, 29, 1380, 3900].map(formatDuration)).toEqual(['—', '—', '0 min', '23 min', '1 h 05 min']);
  });
});
