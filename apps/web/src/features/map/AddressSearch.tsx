// Address box: searches 400 ms after the user stops typing (3+ characters); the candidates are
// inside the chosen city. When search is unavailable the map can still be clicked.
import { useId, useState } from 'react';
import { describeError } from '../../shared/api/client.ts';
import { useDebounced } from '../../shared/lib/useDebounced.ts';
import type { GeocodeCandidate } from '../../models/types.ts';
import { useGeocode } from './api/geocode.ts';

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
  const listId = useId();

  // A new pick from outside (map click, shared link) replaces the text.
  if (selected !== previous) {
    setPrevious(selected);
    setText(selected ?? '');
    setDirty(false);
  }

  const q = text.trim();
  const wanted = dirty && q.length >= 3 ? q : undefined;
  const settled = useDebounced(wanted, DEBOUNCE_MS);
  const geocode = useGeocode(cityCode, settled !== undefined && settled === wanted ? settled : undefined);
  const search: Search | undefined =
    wanted === undefined || settled !== wanted
      ? undefined
      : geocode.isPending
        ? { kind: 'searching' }
        : geocode.isError
          ? { kind: 'error', message: describeError(geocode.error) }
          : { kind: 'results', items: uniqueByName(geocode.data) };

  const pick = (candidate: GeocodeCandidate) => {
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
