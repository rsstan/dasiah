import { useState } from 'react';
import { describeError } from '../../shared/api/client.ts';
import type { City } from '../../models/types.ts';
import { CityFilter } from '../cities/CityFilter.tsx';
import { PLACE_LIMIT, type Places, type SavedPlace } from './api.ts';
import { KIND_LABEL } from './SavePlaceForm.tsx';
import { Button, Card, Dialog, Select, Skeleton, TextField } from '../../shared/ui/index.ts';
import { LABEL_MAX, labelConflict, validateLabel } from './validation.ts';
import { useParam } from '../../shared/lib/useParam.ts';
import { arrangePlaces, PLACE_SORT_LABEL, PLACE_SORTS, type PlaceSort } from './sort.ts';

interface Props {
  places: Places;
  cities: readonly City[];
  onShow: (place: SavedPlace) => void;
}

export function PlacesList({ places, cities, onShow }: Props) {
  const [editing, setEditing] = useState<{ id: string; label: string; error?: string } | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<SavedPlace | undefined>(undefined);
  const cityName = (code: string) => cities.find((c) => c.code === code)?.name ?? code;
  const [cityFilter, setCityFilter] = useParam<string>('city', '');
  const [sort, setSort] = useParam<PlaceSort>('sort', 'recent', PLACE_SORTS);
  const shown = arrangePlaces(places.items, cityFilter, sort, cityName);

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
      {!places.loading && places.error === undefined && places.items.length === 0 && (
        <p className="hint">No saved places yet. Pick a start point on the map and save it.</p>
      )}
      {places.items.length > 1 && (
        <div className="list-tools">
          <CityFilter
            cities={cities}
            present={places.items.map((p) => p.cityCode)}
            value={cityFilter}
            onChange={setCityFilter}
          />
          <Select inline label="Sort" value={sort} onChange={(e) => setSort(e.target.value as PlaceSort)}>
            {PLACE_SORTS.map((s) => (
              <option key={s} value={s}>
                {PLACE_SORT_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
      )}
      <ul className="items">
        {shown.map((p) => (
          <li key={p.placeId}>
            {editing?.id === p.placeId ? (
              <form
                className="inline-edit"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  const invalid = validateLabel(editing.label, 'rename');
                  if (invalid !== undefined) {
                    setEditing({ ...editing, error: invalid });
                    return;
                  }
                  setError(undefined);
                  places.update(p.placeId, { label: editing.label.trim() }).then(
                    () => setEditing(undefined),
                    (err: unknown) => {
                      const conflict = labelConflict(err);
                      if (conflict !== undefined) {
                        setEditing({ ...editing, error: conflict });
                      } else {
                        setError(describeError(err));
                      }
                    },
                  );
                }}
              >
                <TextField
                  label={<span className="visually-hidden">New name</span>}
                  maxLength={LABEL_MAX}
                  value={editing.label}
                  error={editing.error}
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
