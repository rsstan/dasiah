import { useState, type FormEvent } from 'react';
import { describeError } from '../../shared/api/client.ts';
import type { Origin } from '../map/urlState.ts';
import type { PlaceKind, Places } from './api.ts';
import { Button, Select, TextField } from '../../shared/ui/index.ts';
import { labelConflict, validateLabel } from './validation.ts';

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
  const [labelError, setLabelError] = useState<string | undefined>(undefined);

  if (!open) {
    return (
      <div className="save-place">
        <Button onClick={() => setOpen(true)}>☆ Save this start point</Button>
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
    const invalid = validateLabel(label, 'save');
    setLabelError(invalid);
    if (invalid !== undefined) {
      return;
    }
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
      const conflict = labelConflict(err);
      if (conflict !== undefined) {
        setLabelError(conflict);
      } else {
        setMessage({ error: true, text: describeError(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="save-place form" noValidate onSubmit={(e) => void submit(e)}>
      <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)}>
        {Object.entries(KIND_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <TextField
        label="Name"
        type="text"
        maxLength={60}
        placeholder={KIND_LABEL[kind]}
        value={label}
        hint="Empty: the kind's name."
        error={labelError}
        onChange={(e) => {
          setLabel(e.target.value);
          setLabelError(undefined);
        }}
      />
      {message?.error === true && (
        <p className="form-error" role="alert">
          {message.text}
        </p>
      )}
      <div className="actions">
        <Button type="submit" variant="primary" loading={busy}>
          Save
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
