// Administration data (server state, TanStack Query): feed versions (polled while an import is
// running), coverage per city, import and activation. A mutation refreshes what it changes; an
// activation also changes the cities (their active feed).
import type { GatewayApi } from '@heatmap/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../shared/api/client.ts';
import { ME } from '../../shared/api/queryClient.ts';
import type { City } from '../../models/types.ts';
import { citiesKey } from '../cities/api.ts';

type Schemas = GatewayApi.components['schemas'];
export type FeedVersion = Schemas['FeedVersion'];
export type FeedStatus = Schemas['FeedStatus'];
export type ImportAccepted = Schemas['ImportAccepted'];
export type CityCoverage = Schemas['CityCoverage'];

/** Statuses of an import still in progress: the list is polled while one is present. */
export const IN_PROGRESS: readonly FeedStatus[] = ['downloaded', 'staged'];
export const POLL_MS = 3_000;

export interface VersionFilter {
  status: FeedStatus | '';
  source: string;
}

const versionsKey = [ME, 'admin', 'feed-versions'] as const;
const coverageKey = (code: string) => ['coverage', code] as const;

export function useFeedVersions(filter: VersionFilter) {
  return useQuery({
    queryKey: [...versionsKey, filter],
    queryFn: async ({ signal }) =>
      (
        await request<{ items: FeedVersion[] }>('/admin/feed-versions', {
          query: { limit: 100, status: filter.status, source: filter.source },
          signal,
        })
      ).body.items,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((v) => IN_PROGRESS.includes(v.status)) ? POLL_MS : false,
  });
}

export function useCoverage(cities: readonly City[]) {
  return useQueries({
    queries: cities.map((city) => ({
      queryKey: coverageKey(city.code),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (await request<CityCoverage>(`/cities/${city.code}/coverage`, { signal })).body,
    })),
  });
}

function useRefreshAfterChange() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: versionsKey });
    void client.invalidateQueries({ queryKey: ['coverage'] });
    void client.invalidateQueries({ queryKey: citiesKey });
  };
}

export function useImportFeed() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: async (sourceCode: string) =>
      (
        await request<ImportAccepted>(`/admin/feed-sources/${encodeURIComponent(sourceCode)}/import`, {
          method: 'POST',
        })
      ).body,
    onSuccess: refresh,
  });
}

export function useActivateVersion() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: async (feedVersionId: number) => {
      await request(`/admin/feed-versions/${feedVersionId}/activate`, { method: 'POST' });
    },
    onSuccess: refresh,
  });
}
