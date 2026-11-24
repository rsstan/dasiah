// Cities of this instance and the legend: public, rarely changing, loaded once per visit.
import { useQuery } from '@tanstack/react-query';
import { request } from '../../shared/api/client.ts';
import type { City, LegendClass } from '../../models/types.ts';

export const citiesKey = ['cities'] as const;
export const legendKey = ['legend'] as const;

export function useCitiesQuery() {
  return useQuery({
    queryKey: citiesKey,
    queryFn: async ({ signal }) => (await request<{ items: City[] }>('/cities', { signal })).body.items,
    staleTime: 5 * 60_000,
  });
}

export function useLegendQuery() {
  return useQuery({
    queryKey: legendKey,
    queryFn: async ({ signal }) => (await request<{ items: LegendClass[] }>('/legend', { signal })).body.items,
    staleTime: Infinity,
  });
}
