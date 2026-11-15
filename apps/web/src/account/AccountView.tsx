import { useState } from 'react';
import { describeError } from '../api/client.ts';
import { session, type UserProfile } from '../session/session.ts';

export function AccountView({ user }: { user: UserProfile }) {
  const [name, setName] = useState(user.displayName ?? '');
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
    <section className="account" aria-label="Account">
      <h2>Account</h2>
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Member since</dt>
        <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
      </dl>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => session.updateDisplayName(name.trim() === '' ? null : name.trim()), 'Saved.');
        }}
      >
        <label>
          Name
          <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          Save name
        </button>
      </form>
      {message !== undefined && (
        <p className={message.error ? 'form-error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <button type="button" onClick={() => void run(() => session.signOut())} disabled={busy}>
        Sign out
      </button>

      <div className="danger-zone">
        <h3>Delete account</h3>
        <p className="hint">
          Your email, name, saved places and history are erased in every part of the service. Maps are not linked to
          you. This cannot be undone.
        </p>
        {!confirming ? (
          <button type="button" className="danger" onClick={() => setConfirming(true)}>
            Delete my account…
          </button>
        ) : (
          <div className="form">
            <label className="checkbox">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I
              understand that this cannot be undone
            </label>
            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={!understood || busy}
                onClick={() => void run(() => session.deleteAccount())}
              >
                Delete permanently
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
