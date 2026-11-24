// From result cells (H3 resolution 9) to what the map draws. Zoomed out, cells are merged into
// their parents (docs/05-algorithms.md#10): the parent takes the median ratio and times of its
// children with a value and is classified with the legend; a parent without any value takes the
// most common special class of its children.
import { cellToBoundary, cellToParent, getResolution } from 'h3-js';
import type { CellResult, LegendClass, LegendClassCode } from '../../models/types.ts';

export interface MapCell {
  h3: string;
  transitS: number | null;
  carS: number | null;
  ratio: number | null;
  class: LegendClassCode;
  /** Result cells merged into this one (1 at the calculation's resolution). */
  count: number;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Legend class of a ratio: minRatio inclusive, maxRatio exclusive (null = unbounded). */
export function classify(ratio: number, legend: readonly LegendClass[]): LegendClassCode {
  const hit = legend.find(
    (c) => c.minRatio !== null && ratio >= c.minRatio && (c.maxRatio === null || ratio < c.maxRatio),
  );
  return hit?.code ?? 'very_poor';
}

export function aggregate(cells: readonly CellResult[], resolution: number, legend: readonly LegendClass[]): MapCell[] {
  if (cells.length === 0) {
    return [];
  }
  if (getResolution((cells[0] as CellResult).h3) <= resolution) {
    return cells.map((c) => ({ ...c, count: 1 }));
  }
  const groups = new Map<string, CellResult[]>();
  for (const cell of cells) {
    const parent = cellToParent(cell.h3, resolution);
    const group = groups.get(parent);
    if (group === undefined) {
      groups.set(parent, [cell]);
    } else {
      group.push(cell);
    }
  }
  const order = new Map(legend.map((c) => [c.code, c.sortOrder]));
  const out: MapCell[] = [];
  for (const [h3, children] of groups) {
    const ratios = children.flatMap((c) => (c.ratio === null ? [] : [c.ratio]));
    const ratio = median(ratios);
    const round = (v: number | null) => (v === null ? null : Math.round(v));
    let cls: LegendClassCode;
    if (ratio !== null) {
      cls = classify(ratio, legend);
    } else {
      const counts = new Map<LegendClassCode, number>();
      for (const c of children) {
        counts.set(c.class, (counts.get(c.class) ?? 0) + 1);
      }
      cls = [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99),
      )[0]?.[0] as LegendClassCode;
    }
    out.push({
      h3,
      transitS: round(median(children.flatMap((c) => (c.transitS === null ? [] : [c.transitS])))),
      carS: round(median(children.flatMap((c) => (c.carS === null ? [] : [c.carS])))),
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      class: cls,
      count: children.length,
    });
  }
  return out;
}

export interface CellFeature {
  type: 'Feature';
  id: number;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: MapCell & { color: string };
}

/** GeoJSON polygons ([lon, lat], closed rings) coloured by legend class. */
export function toFeatureCollection(cells: readonly MapCell[], legend: readonly LegendClass[]) {
  const colors = new Map(legend.map((c) => [c.code, c.color]));
  const features: CellFeature[] = cells.map((cell, i) => {
    const ring = cellToBoundary(cell.h3, true) as [number, number][];
    return {
      type: 'Feature',
      id: i,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { ...cell, color: colors.get(cell.class) ?? '#999999' },
    };
  });
  return { type: 'FeatureCollection' as const, features };
}

export type CellCollection = ReturnType<typeof toFeatureCollection>;

/** A job for the hexagon worker (hexagons.worker.ts); `id` matches the answer to the request. */
export interface PrepareRequest {
  id: number;
  cells: readonly CellResult[];
  resolution: number;
  legend: readonly LegendClass[];
}

/** What the map draws for result cells at a resolution: merged cells as coloured polygons. */
export function prepare({ cells, resolution, legend }: Omit<PrepareRequest, 'id'>): CellCollection {
  return toFeatureCollection(aggregate(cells, resolution, legend), legend);
}
