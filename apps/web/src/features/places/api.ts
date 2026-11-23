// Saved places of the signed-in user (server state, TanStack Query). One cached list shared by
// the city page (quick picks, "save") and the places page; mutations update the cache from the
// server's answer, so both see a change at once.
import type { GatewayApi } from '@heatmap/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError, request } from '../../shared/api/client.ts';
import { ME } from '../../shared/api/queryClient.ts';

type Schemas = GatewayApi.components['schemas'];
export type SavedPlace = Schemas['SavedPlace'];
export type PlaceKind = Schemas['PlaceKind'];
export type CreatePlace = Schemas['CreatePlaceRequest'];
export type UpdatePlace = Schemas['UpdatePlaceRequest'];

export const PLACE_LIMIT = 20;
export const placesKey = [ME, 'places'] as const;

export interface Places {
  items: SavedPlace[];
  loading: boolean;
  error: string | undefined;
  reload(): void;
  create(place: CreatePlace): Promise<SavedPlace>;
  update(placeId: string, change: UpdatePlace): Promise<void>;
  remove(placeId: string): Promise<void>;
}

export function usePlaces(enabled: boolean): Places {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: placesKey,
    queryFn: async ({ signal }) => (await request<{ items: SavedPlace[] }>('/places', { signal })).body.items,
    enabled,
  });
  const setList = (change: (list: SavedPlace[]) => SavedPlace[]) =>
    client.setQueryData<SavedPlace[]>(placesKey, (list) => change(list ?? []));

  const createMutation = useMutation({
    mutationFn: async (place: CreatePlace) =>
      (await request<SavedPlace>('/places', { method: 'POST', body: place })).body,
    onSuccess: (created) => setList((list) => [created, ...list]),
  });
  const updateMutation = useMutation({
    mutationFn: async ({ placeId, change }: { placeId: string; change: UpdatePlace }) =>
      (await request<SavedPlace>(`/places/${placeId}`, { method: 'PATCH', body: change })).body,
    onSuccess: (updated) => setList((list) => list.map((p) => (p.placeId === updated.placeId ? updated : p))),
  });
  const removeMutation = useMutation({
    mutationFn: async (placeId: string) => {
      await request(`/places/${placeId}`, { method: 'DELETE' });
      return placeId;
    },
    onSuccess: (placeId) => setList((list) => list.filter((p) => p.placeId !== placeId)),
  });

  return {
    items: enabled ? (query.data ?? []) : [],
    loading: enabled && query.isPending,
    error: enabled && query.isError ? describeError(query.error) : undefined,
    reload: () => void query.refetch(),
    create: (place) => createMutation.mutateAsync(place),
    update: async (placeId, change) => {
      await updateMutation.mutateAsync({ placeId, change });
    },
    remove: async (placeId) => {
      await removeMutation.mutateAsync(placeId);
    },
  };
}
