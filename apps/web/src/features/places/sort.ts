import type { SavedPlace } from './api.ts';

export const PLACE_SORTS = ['recent', 'name', 'city'] as const;
export type PlaceSort = (typeof PLACE_SORTS)[number];

export const PLACE_SORT_LABEL: Record<PlaceSort, string> = {
  recent: 'Newest first',
  name: 'Name',
  city: 'City',
};

/** Places of one city (or all) in the chosen order; ties by name. */
export function arrangePlaces(
  places: readonly SavedPlace[],
  city: string,
  sort: PlaceSort,
  cityName: (code: string) => string,
): SavedPlace[] {
  const byName = (a: SavedPlace, b: SavedPlace) => a.label.localeCompare(b.label);
  const compare: Record<PlaceSort, (a: SavedPlace, b: SavedPlace) => number> = {
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b),
    name: byName,
    city: (a, b) => cityName(a.cityCode).localeCompare(cityName(b.cityCode)) || byName(a, b),
  };
  return places.filter((p) => city === '' || p.cityCode === city).sort(compare[sort]);
}
