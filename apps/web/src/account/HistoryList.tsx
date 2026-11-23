// The maps the user looked at (newest first, 50 kept). Filled asynchronously from
// accessibility.calculation.completed.v1, so it is reloaded every time the tab opens.
import type { GatewayApi } from '@heatmap/contracts';
import { useEffect, useState } from 'react';
import { describeError, request } from '../api/client.ts';
import { CityFilter } from '../components/CityFilter.tsx';
import type { City } from '../api/types.ts';

export type HistoryEntry = GatewayApi.components['schemas']['HistoryEntry'];
interface Page {
  items: HistoryEntry[];
  nextCursor: string | null;
}

export function HistoryList({ cities, onOpen }: { cities: readonly City[]; onOpen: (entry: HistoryEntry) => void }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [state, setState] = useState<{ loading: boolean; error: string | undefined }>({
    loading: true,
    error: undefined,
  });
  const cityName = (code: string) => cities.find((c) => c.code === code)?.name ?? code;

  useEffect(() => {
    const controller = new AbortController();
    request<Page>('/history', { query: { limit: 20, cursor }, signal: controller.signal }).then(
      (res) => {
        setPages((list) => (cursor === undefined ? [res.body] : [...list, res.body]));
        setState({ loading: false, error: undefined });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: describeError(error) });
        }
      },
    );
    return () => controller.abort();
  }, [cursor]);

  const [cityFilter, setCityFilter] = useState('');
  const loaded = pages.flatMap((p) => p.items);
  const items = loaded.filter((h) => cityFilter === '' || h.cityCode === cityFilter);
  const next = pages.at(-1)?.nextCursor ?? null;
  return (
    <section className="list-view" aria-label="History">
      <h2>History</h2>
      <CityFilter cities={cities} present={loaded.map((h) => h.cityCode)} value={cityFilter} onChange={setCityFilter} />
      {state.error !== undefined && <p className="form-error">{state.error}</p>}
      {!state.loading && items.length === 0 && state.error === undefined && (
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
      {state.loading && <p className="hint">Loading…</p>}
      {!state.loading && next !== null && (
        <button
          type="button"
          onClick={() => {
            setState({ loading: true, error: undefined });
            setCursor(next);
          }}
        >
          Show older
        </button>
      )}
    </section>
  );
}
