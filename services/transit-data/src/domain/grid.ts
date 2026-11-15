// The H3 grid of a city: every cell at the city's resolution whose centre lies inside the city
// boundary (h3-js polygonToCells), with the cell centre as centroid.
import { cellToLatLng, polygonToCells } from 'h3-js';

export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  /** Rings of [lon, lat] positions; the first is the outer ring. */
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

export interface GridCell {
  readonly h3: string;
  readonly lat: number;
  readonly lon: number;
}

export function gridCells(boundary: GeoJsonPolygon, resolution: number): GridCell[] {
  if (boundary.type !== 'Polygon' || boundary.coordinates.length === 0) {
    throw new Error('the boundary must be a GeoJSON Polygon');
  }
  const coordinates = boundary.coordinates.map((ring) => ring.map(([lon, lat]) => [lon, lat]));
  return polygonToCells(coordinates, resolution, true)
    .sort()
    .map((h3) => {
      const [lat, lon] = cellToLatLng(h3);
      return { h3, lat, lon };
    });
}
