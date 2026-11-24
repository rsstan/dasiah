// Address box: searches 400 ms after the user stops typing (3+ characters); the candidates are
// inside the chosen city. When search is unavailable the map can still be clicked.
// Keyboard (WAI-ARIA combobox with a list box): Down/Up move through the suggestions (the focus
// stays in the box, aria-activedescendant names the active one), Enter picks the active one or
// the first, Escape closes the list.
import { useId, useState } from 'react';
import { describeError } from '../../shared/api/client.ts';
import { useDebounced } from '../../shared/lib/useDebounced.ts';
import type { GeocodeCandidate } from '../../models/types.ts';
import { useGeocode } from './api/geocode.ts';
import { TextField } from '../../shared/ui/index.ts';

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
  /** Index of the highlighted suggestion; -1 for none. */
  const [active, setActive] = useState(-1);
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

  const items = search?.kind === 'results' ? search.items : [];
  const open = items.length > 0;
  // New suggestions start without a highlight.
  const [shownFor, setShownFor] = useState(items);
  if (shownFor !== items && (shownFor.length !== items.length || shownFor.some((c, i) => c !== items[i]))) {
    setShownFor(items);
    setActive(-1);
  }
  const optionId = (index: number) => `${listId}-option-${index}`;

  const pick = (candidate: GeocodeCandidate) => {
    setActive(-1);
    setDirty(false);
    setText(candidate.displayName);
    onSelect(candidate);
  };

  return (
    <div className="address-search">
      <TextField
        label="Start address"
        type="search"
        autoComplete="off"
        placeholder="Street and number, or click the map"
        value={text}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            setActive((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === 'ArrowUp' && open) {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const chosen = items[active] ?? items[0];
            if (chosen !== undefined) {
              pick(chosen);
            }
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            setActive(-1);
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
      {open && (
        <ul id={listId} className="candidates" role="listbox" aria-label="Addresses found">
          {items.map((c, i) => (
            <li
              key={`${c.lat},${c.lon},${c.displayName}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // Keep the focus in the box while clicking a suggestion.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              {c.displayName}
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
