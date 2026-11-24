import { describe, expect, it } from 'vitest';
import type { SavedPlace } from './api.ts';
import { arrangePlaces } from './sort.ts';

const place = (label: string, cityCode: string, createdAt: string): SavedPlace => ({
  placeId: label,
  kind: 'other',
  label,
  addressText: 'x',
  cityCode,
  location: { lat: 0, lon: 0 },
  createdAt,
  updatedAt: createdAt,
});
const PLACES = [
  place('Office', 'waw', '2026-11-02T00:00:00Z'),
  place('Home', 'vno', '2026-11-03T00:00:00Z'),
  place('Gym', 'waw', '2026-11-01T00:00:00Z'),
];
const NAMES: Record<string, string> = { waw: 'Warsaw', vno: 'Vilnius' };
const labels = (list: SavedPlace[]) => list.map((p) => p.label);

describe('arranging saved places', () => {
  it('sorts by date, name or city, and filters by city', () => {
    expect(labels(arrangePlaces(PLACES, '', 'recent', (c) => NAMES[c] ?? c))).toEqual(['Home', 'Office', 'Gym']);
    expect(labels(arrangePlaces(PLACES, '', 'name', (c) => NAMES[c] ?? c))).toEqual(['Gym', 'Home', 'Office']);
    expect(labels(arrangePlaces(PLACES, '', 'city', (c) => NAMES[c] ?? c))).toEqual(['Home', 'Gym', 'Office']);
    expect(labels(arrangePlaces(PLACES, 'waw', 'name', (c) => NAMES[c] ?? c))).toEqual(['Gym', 'Office']);
  });
});
