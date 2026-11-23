import { useState } from 'react';
import { describeError } from '../../shared/api/client.ts';
import type { City } from '../../models/types.ts';
import { CityFilter } from '../cities/CityFilter.tsx';
import { PLACE_LIMIT, type Places, type SavedPlace } from './api.ts';
import { KIND_LABEL } from './SavePlaceForm.tsx';
import { Button, Card, Dialog, Skeleton, TextField } from '../../shared/ui/index.ts';

interface Props {
  places: Places;
  cities: readonly City[];
  onShow: (place: SavedPlace) => void;
}

export function PlacesList({ places, cities, onShow }: Props) {
  const [editing, setEditing] = useState<{ id: string; label: string } | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<SavedPlace | undefined>(undefined);
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
    <Card
      className="list-view"
      aria-label="Saved places"
      title={
        <>
          Saved places{' '}
          <span className="count">
            {places.items.length} of {PLACE_LIMIT}
          </span>
        </>
      }
    >
      {places.loading && <Skeleton lines={3} variant="card" />}
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
                <TextField
                  label={<span className="visually-hidden">New name</span>}
                  maxLength={60}
                  required
                  value={editing.label}
                  onChange={(e) => setEditing({ id: p.placeId, label: e.target.value })}
                />
                <Button type="submit" variant="primary" size="sm">
                  Save
                </Button>
                <Button size="sm" onClick={() => setEditing(undefined)}>
                  Cancel
                </Button>
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
                  <Button size="sm" onClick={() => setEditing({ id: p.placeId, label: p.label })}>
                    Rename
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleting(p)}>
                    Delete
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <Dialog
        open={deleting !== undefined}
        title="Delete this place?"
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(undefined);
          if (target !== undefined) {
            void act(() => places.remove(target.placeId));
          }
        }}
      >
        “{deleting?.label}” will be removed from your saved places.
      </Dialog>
    </Card>
  );
}
