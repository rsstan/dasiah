// The maps the user looked at (server state, TanStack Query). Filled asynchronously from
// accessibility.calculation.completed.v1, so the list is fetched again whenever it is shown.
import type { GatewayApi } from '@heatmap/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { request } from '../../shared/api/client.ts';
import { ME } from '../../shared/api/queryClient.ts';

export type HistoryEntry = GatewayApi.components['schemas']['HistoryEntry'];
export interface HistoryPage {
  items: HistoryEntry[];
  nextCursor: string | null;
}

export const historyKey = [ME, 'history'] as const;
const PAGE = 20;

export function useHistory() {
  return useInfiniteQuery({
    queryKey: historyKey,
    queryFn: async ({ pageParam, signal }) =>
      (await request<HistoryPage>('/history', { query: { limit: PAGE, cursor: pageParam }, signal })).body,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchOnMount: 'always',
  });
}
