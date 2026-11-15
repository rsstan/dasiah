// Address box: asks GET /geocode 400 ms after the user stops typing (3+ characters); the
// candidates are inside the chosen city. When search is unavailable the map can still be clicked.
import { useEffect, useId, useState } from 'react';
import { describeError, request } from '../api/client.ts';
import type { GeocodeCandidate } from '../api/types.ts';

interface Props {
  cityCode: string;
  /** Text shown after a pick (the chosen address, or "Point on the map"). */
  selected: string | undefined;
  onSelect: (candidate: GeocodeCandidate) => void;
}

type Search =
  { kind: 'searching' } | { kind: 'results'; items: GeocodeCandidate[] } | { kind: 'error'; message: string };

export const DEBOUNCE_MS = 400;

export function AddressSearch({ cityCode, selected, onSelect }: Props) {
  const [text, setText] = useState(selected ?? '');
  const [dirty, setDirty] = useState(false);
  const [previous, setPrevious] = useState(selected);
  /** Last answer, tagged with the query it belongs to. */
  const [answer, setAnswer] = useState<{ key: string; search: Search } | undefined>(undefined);
  const listId = useId();

  // A new pick from outside (map click, shared link) replaces the text.
  if (selected !== previous) {
    setPrevious(selected);
    setText(selected ?? '');
    setDirty(false);
  }

  const q = text.trim();
  const key = dirty && q.length >= 3 ? `${cityCode}|${q}` : undefined;
  const search: Search | undefined = key !== undefined && answer?.key === key ? answer.search : undefined;

  useEffect(() => {
    if (key === undefined) {
      return;
    }
    const [city, query] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAnswer({ key, search: { kind: 'searching' } });
      request<{ items: GeocodeCandidate[] }>('/geocode', {
        query: { city, q: query },
        signal: controller.signal,
      }).then(
        (res) => setAnswer({ key, search: { kind: 'results', items: uniqueByName(res.body.items) } }),
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setAnswer({ key, search: { kind: 'error', message: describeError(error) } });
          }
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const pick = (candidate: GeocodeCandidate) => {
    setAnswer(undefined);
    setDirty(false);
    setText(candidate.displayName);
    onSelect(candidate);
  };

  return (
    <div className="address-search">
      <label htmlFor={`${listId}-input`}>Start address</label>
      <input
        id={`${listId}-input`}
        type="search"
        autoComplete="off"
        placeholder="Street and number, or click the map"
        value={text}
        aria-controls={listId}
        aria-expanded={search?.kind === 'results'}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && search?.kind === 'results' && search.items[0] !== undefined) {
            pick(search.items[0]);
          }
          if (e.key === 'Escape') {
            setDirty(false);
          }
        }}
      />
      {search?.kind === 'searching' && <p className="hint">Searching…</p>}
      {search?.kind === 'error' && (
        <p className="hint error" role="alert">
          {search.message} You can click the map instead.
        </p>
      )}
      {search?.kind === 'results' && search.items.length === 0 && (
        <p className="hint">No address found in this city.</p>
      )}
      {search?.kind === 'results' && search.items.length > 0 && (
        <ul id={listId} className="candidates" role="listbox">
          {search.items.map((c) => (
            <li key={`${c.lat},${c.lon},${c.displayName}`} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(c)}>
                {c.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The geocoder may return several entrances of one building under the same name; keep the first. */
export function uniqueByName(items: readonly GeocodeCandidate[]): GeocodeCandidate[] {
  const seen = new Set<string>();
  return items.filter((c) => !seen.has(c.displayName) && seen.add(c.displayName) !== undefined);
}
