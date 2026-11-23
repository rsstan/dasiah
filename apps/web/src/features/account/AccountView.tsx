import { useState } from 'react';
import { describeError } from '../../shared/api/client.ts';
import { session, type UserProfile } from '../auth/session.ts';
import { Button, Card, Checkbox, TextField } from '../../shared/ui/index.ts';
import { check, maxLength } from '../../shared/lib/validation.ts';

export function AccountView({ user }: { user: UserProfile }) {
  const [name, setName] = useState(user.displayName ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | undefined>(undefined);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await fn();
      if (done !== undefined) {
        setMessage({ error: false, text: done });
      }
    } catch (err) {
      setMessage({ error: true, text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="account" aria-label="Account" title="Account">
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Member since</dt>
        <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
      </dl>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const invalid = check({ name }, { name: [maxLength(80, 'The name')] }).name;
          setNameError(invalid);
          if (invalid === undefined) {
            void run(() => session.updateDisplayName(name.trim() === '' ? null : name.trim()), 'Saved.');
          }
        }}
      >
        <TextField
          label="Name"
          type="text"
          maxLength={80}
          value={name}
          error={nameError}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(undefined);
          }}
        />
        <Button type="submit" loading={busy}>
          Save name
        </Button>
      </form>
      {message !== undefined && (
        <p className={message.error ? 'form-error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <div>
        <Button onClick={() => void run(() => session.signOut())} disabled={busy}>
          Sign out
        </Button>
      </div>

      <div className="danger-zone">
        <h3>Delete account</h3>
        <p className="hint">
          Your email, name, saved places and history are erased in every part of the service. Maps are not linked to
          you. This cannot be undone.
        </p>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete my account…
          </Button>
        ) : (
          <div className="form">
            <Checkbox
              label="I understand that this cannot be undone"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <div className="actions">
              <Button
                variant="danger"
                disabled={!understood}
                loading={busy}
                onClick={() => void run(() => session.deleteAccount())}
              >
                Delete permanently
              </Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
