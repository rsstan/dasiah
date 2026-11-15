import { useState, type FormEvent } from 'react';
import { describeError } from '../api/client.ts';
import type { Origin } from '../urlState.ts';
import type { PlaceKind, Places } from '../session/usePlaces.ts';

export const KIND_LABEL: Record<PlaceKind, string> = { home: 'Home', work: 'Work', study: 'Study', other: 'Other' };

/** Address text stored with a place: the geocoded name, or the coordinates of a map click. */
export function addressOf(origin: Origin): string {
  return origin.address ?? `${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`;
}

export function SavePlaceForm({ origin, cityCode, places }: { origin: Origin; cityCode: string; places: Places }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PlaceKind>('home');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | undefined>(undefined);

  if (!open) {
    return (
      <div className="save-place">
        <button type="button" onClick={() => setOpen(true)}>
          ☆ Save this start point
        </button>
        {message !== undefined && (
          <p className={message.error ? 'form-error' : 'hint'} role="status">
            {message.text}
          </p>
        )}
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const name = label.trim() === '' ? KIND_LABEL[kind] : label.trim();
    try {
      await places.create({
        kind,
        label: name,
        addressText: addressOf(origin),
        cityCode,
        location: { lat: origin.lat, lon: origin.lon },
      });
      setMessage({ error: false, text: `Saved as “${name}”.` });
      setOpen(false);
      setLabel('');
    } catch (err) {
      setMessage({ error: true, text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="save-place form" onSubmit={(e) => void submit(e)}>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)}>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input
          type="text"
          maxLength={60}
          placeholder={KIND_LABEL[kind]}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      {message?.error === true && (
        <p className="form-error" role="alert">
          {message.text}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
