import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cellArea, getResolution, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { gridCells, type GeoJsonPolygon } from './grid.ts';

const boundary = (code: string): GeoJsonPolygon =>
  (
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../../db/seed/reference/boundaries', `${code}.geojson`), 'utf8'),
    ) as {
      geometry: GeoJsonPolygon;
    }
  ).geometry;

describe('city grid', () => {
  // Cells at latitude 52-55 are smaller than the H3 average (about 0.097 km2 instead of 0.105).
  it('covers Warsaw with about 5 300 resolution-9 cells', () => {
    const cells = gridCells(boundary('waw'), 9);
    expect(cells.length).toBeGreaterThan(5_100);
    expect(cells.length).toBeLessThan(5_600);
    expect(new Set(cells.map((c) => c.h3)).size).toBe(cells.length);
    expect(cells.every((c) => getResolution(c.h3) === 9)).toBe(true);
    const km2 = cells.reduce((sum, c) => sum + cellArea(c.h3, 'km2'), 0);
    expect(km2).toBeGreaterThan(490); // city area 517 km2
    expect(km2).toBeLessThan(545);
    // Palace of Culture and Science is in the grid; Piaseczno (outside the city) is not.
    const ids = new Set(cells.map((c) => c.h3));
    expect(ids.has(latLngToCell(52.2318, 21.0059, 9))).toBe(true);
    expect(ids.has(latLngToCell(52.0841, 21.0242, 9))).toBe(false);
  });

  it('covers Vilnius and is deterministic', () => {
    const a = gridCells(boundary('vno'), 9);
    expect(a.length).toBeGreaterThan(4_100);
    expect(a.length).toBeLessThan(4_600);
    expect(gridCells(boundary('vno'), 9)).toEqual(a);
    // 0.2 s normally, but h3-js runs some 30 times slower under V8 coverage.
  }, 60_000);

  it('refuses anything but a polygon', () => {
    expect(() => gridCells({ type: 'Point', coordinates: [] } as unknown as GeoJsonPolygon, 9)).toThrow(/Polygon/);
  });
});
