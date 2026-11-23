// Address search (GET /geocode) as a query: one cache entry per city and text, so a repeated
// search answers at once and a late answer can never replace a newer one.
import { useQuery } from '@tanstack/react-query';
import { request } from '../../../shared/api/client.ts';
import type { GeocodeCandidate } from '../../../models/types.ts';

export function useGeocode(cityCode: string, query: string | undefined) {
  return useQuery({
    queryKey: ['geocode', cityCode, query],
    queryFn: async ({ signal }) =>
      (await request<{ items: GeocodeCandidate[] }>('/geocode', { query: { city: cityCode, q: query }, signal })).body
        .items,
    enabled: query !== undefined,
    staleTime: 10 * 60_000,
  });
}
