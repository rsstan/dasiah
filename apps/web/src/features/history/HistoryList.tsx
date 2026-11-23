// The maps the user looked at (newest first, 50 kept), with a city filter and "show older".
import { useState } from 'react';
import { describeError } from '../../shared/api/client.ts';
import { CityFilter } from '../cities/CityFilter.tsx';
import type { City } from '../../models/types.ts';
import { useHistory, type HistoryEntry } from './api.ts';
import { Button, Card, Skeleton } from '../../shared/ui/index.ts';

export type { HistoryEntry } from './api.ts';

export function HistoryList({ cities, onOpen }: { cities: readonly City[]; onOpen: (entry: HistoryEntry) => void }) {
  const history = useHistory();
  const cityName = (code: string) => cities.find((c) => c.code === code)?.name ?? code;
  const error = history.isError ? describeError(history.error) : undefined;
  const loading = history.isPending || history.isFetchingNextPage;

  const [cityFilter, setCityFilter] = useState('');
  const loaded = history.data?.pages.flatMap((p) => p.items) ?? [];
  const items = loaded.filter((h) => cityFilter === '' || h.cityCode === cityFilter);
  return (
    <Card className="list-view" aria-label="History" title="History">
      <CityFilter cities={cities} present={loaded.map((h) => h.cityCode)} value={cityFilter} onChange={setCityFilter} />
      {error !== undefined && <p className="form-error">{error}</p>}
      {!loading && items.length === 0 && error === undefined && (
        <p className="hint">Maps you compute while signed in appear here.</p>
      )}
      <ul className="items">
        {items.map((h) => (
          <li key={h.calculationId}>
            <button type="button" className="item-main" onClick={() => onOpen(h)}>
              <strong>{cityName(h.cityCode)}</strong>
              <span className="meta">{new Date(h.createdAt).toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
      {loading && <Skeleton lines={3} variant="card" />}
      {!loading && history.hasNextPage && (
        <div>
          <Button onClick={() => void history.fetchNextPage()}>Show older</Button>
        </div>
      )}
    </Card>
  );
}
