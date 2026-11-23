import { describe, expect, it } from 'vitest';
import { sortVersions } from '../admin/sort.ts';
import type { FeedVersion } from '../admin/api.ts';
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

describe('sorting feed versions', () => {
  const v = (feedVersionId: number, status: FeedVersion['status']): FeedVersion => ({
    feedVersionId,
    status,
    sourceCode: 'waw_ztm',
    cityCode: 'waw',
    sha256: 'a'.repeat(64),
    fetchedAt: '2026-11-01T00:00:00Z',
    validFrom: null,
    validTo: null,
    activatedAt: null,
    archivedAt: null,
    errorMessage: null,
  });
  const versions = [v(1, 'archived'), v(3, 'failed'), v(2, 'active'), v(4, 'validated')];
  it('orders by id or puts live versions first', () => {
    expect(sortVersions(versions, 'newest').map((x) => x.feedVersionId)).toEqual([4, 3, 2, 1]);
    expect(sortVersions(versions, 'oldest').map((x) => x.feedVersionId)).toEqual([1, 2, 3, 4]);
    expect(sortVersions(versions, 'status').map((x) => x.status)).toEqual([
      'active',
      'validated',
      'failed',
      'archived',
    ]);
  });
});
