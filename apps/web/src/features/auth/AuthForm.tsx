// Sign in / create account. The password is sent once to identity and never kept in the page.
import { useState, type FormEvent } from 'react';
import { describeError } from '../../shared/api/client.ts';
import { session } from './session.ts';
import { Button, Tabs, TextField, type TabItem } from '../../shared/ui/index.ts';

const MODES: readonly TabItem<'sign-in' | 'register'>[] = [
  { id: 'sign-in', label: 'Sign in' },
  { id: 'register', label: 'Create account' },
];

export const MIN_PASSWORD = 10;

export function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (mode === 'register' && password.length < MIN_PASSWORD) {
      setError(`The password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await session.signIn(email.trim(), password);
      } else {
        await session.register(email.trim(), password, displayName.trim());
      }
      setPassword('');
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const register = mode === 'register';
  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      <h2>{register ? 'Create an account' : 'Sign in'}</h2>
      <p className="hint">Save home and work addresses and see the maps you looked at.</p>
      <Tabs
        label="Sign in or create an account"
        items={MODES}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(undefined);
        }}
      />
      <TextField
        label="Email"
        type="email"
        autoComplete={register ? 'email' : 'username'}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {register && (
        <TextField
          label="Name (optional)"
          type="text"
          maxLength={80}
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      )}
      <TextField
        label="Password"
        type="password"
        autoComplete={register ? 'new-password' : 'current-password'}
        required
        minLength={register ? MIN_PASSWORD : 1}
        maxLength={128}
        hint={register ? `At least ${MIN_PASSWORD} characters.` : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error !== undefined && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" block loading={busy}>
        {register ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  );
}
