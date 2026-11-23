import { useState } from 'react';
import { describeError } from '../api/client.ts';
import type { City } from '../api/types.ts';
import { CityFilter } from '../components/CityFilter.tsx';
import { PLACE_LIMIT, type Places, type SavedPlace } from '../session/usePlaces.ts';
import { KIND_LABEL } from './SavePlaceForm.tsx';

interface Props {
  places: Places;
  cities: readonly City[];
  onShow: (place: SavedPlace) => void;
}

export function PlacesList({ places, cities, onShow }: Props) {
  const [editing, setEditing] = useState<{ id: string; label: string } | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [cityFilter, setCityFilter] = useState('');
  const shown = places.items.filter((p) => cityFilter === '' || p.cityCode === cityFilter);
  const cityName = (code: string) => cities.find((c) => c.code === code)?.name ?? code;

  const act = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <section className="list-view" aria-label="Saved places">
      <h2>
        Saved places{' '}
        <span className="count">
          {places.items.length} of {PLACE_LIMIT}
        </span>
      </h2>
      {places.loading && <p className="hint">Loading…</p>}
      {places.error !== undefined && <p className="form-error">{places.error}</p>}
      {error !== undefined && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!places.loading && places.items.length === 0 && (
        <p className="hint">No saved places yet. Pick a start point on the map and save it.</p>
      )}
      <CityFilter
        cities={cities}
        present={places.items.map((p) => p.cityCode)}
        value={cityFilter}
        onChange={setCityFilter}
      />
      <ul className="items">
        {shown.map((p) => (
          <li key={p.placeId}>
            {editing?.id === p.placeId ? (
              <form
                className="inline-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await places.update(p.placeId, { label: editing.label.trim() });
                    setEditing(undefined);
                  });
                }}
              >
                <input
                  aria-label="New name"
                  maxLength={60}
                  required
                  value={editing.label}
                  onChange={(e) => setEditing({ id: p.placeId, label: e.target.value })}
                />
                <button type="submit" className="primary">
                  Save
                </button>
                <button type="button" onClick={() => setEditing(undefined)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="item-main" onClick={() => onShow(p)}>
                  <strong>{p.label}</strong>
                  <span className="meta">
                    {KIND_LABEL[p.kind]} · {cityName(p.cityCode)}
                  </span>
                  <span className="meta">{p.addressText}</span>
                </button>
                <div className="item-actions">
                  <button type="button" onClick={() => setEditing({ id: p.placeId, label: p.label })}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Delete “${p.label}”?`)) {
                        void act(() => places.remove(p.placeId));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
