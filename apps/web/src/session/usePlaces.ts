// Saved places of the signed-in user, shared by the map tab (quick picks, "Save place") and the
// places tab.
import type { GatewayApi } from '@heatmap/contracts';
import { useCallback, useEffect, useState } from 'react';
import { describeError, request } from '../api/client.ts';

type Schemas = GatewayApi.components['schemas'];
export type SavedPlace = Schemas['SavedPlace'];
export type PlaceKind = Schemas['PlaceKind'];
export type CreatePlace = Schemas['CreatePlaceRequest'];
export type UpdatePlace = Schemas['UpdatePlaceRequest'];

export const PLACE_LIMIT = 20;

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
  const [items, setItems] = useState<SavedPlace[]>([]);
  const [loaded, setLoaded] = useState<{ version: number; error: string | undefined } | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    request<{ items: SavedPlace[] }>('/places', { signal: controller.signal }).then(
      (res) => {
        setItems(res.body.items);
        setLoaded({ version, error: undefined });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setLoaded({ version, error: describeError(error) });
        }
      },
    );
    return () => controller.abort();
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const create = useCallback(async (place: CreatePlace) => {
    const res = await request<SavedPlace>('/places', { method: 'POST', body: place });
    setItems((list) => [res.body, ...list]);
    return res.body;
  }, []);

  const update = useCallback(async (placeId: string, change: UpdatePlace) => {
    const res = await request<SavedPlace>(`/places/${placeId}`, { method: 'PATCH', body: change });
    setItems((list) => list.map((p) => (p.placeId === placeId ? res.body : p)));
  }, []);

  const remove = useCallback(async (placeId: string) => {
    await request(`/places/${placeId}`, { method: 'DELETE' });
    setItems((list) => list.filter((p) => p.placeId !== placeId));
  }, []);

  return {
    items: enabled ? items : [],
    loading: enabled && loaded?.version !== version,
    error: enabled ? loaded?.error : undefined,
    reload,
    create,
    update,
    remove,
  };
}
