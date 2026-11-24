// Sign in / create account. The password is sent once to identity and never kept in the page.
import { useState, type FormEvent } from 'react';
import { describeError } from '../../shared/api/client.ts';
import { hasErrors, serverFieldErrors, type FieldErrors } from '../../shared/lib/validation.ts';
import { Button, Tabs, TextField, type TabItem } from '../../shared/ui/index.ts';
import { session } from './session.ts';
import { AUTH_SERVER_FIELDS, MIN_PASSWORD, validateAuth, type AuthField } from './validation.ts';

const MODES: readonly TabItem<'sign-in' | 'register'>[] = [
  { id: 'sign-in', label: 'Sign in' },
  { id: 'register', label: 'Create account' },
];

export { MIN_PASSWORD } from './validation.ts';

export function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** After the first submit, fields are checked as the user types. */
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors<AuthField>>({});
  const values = { email, password, displayName };
  const errors = submitted ? { ...validateAuth(values, mode), ...serverErrors } : serverErrors;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setServerErrors({});
    setSubmitted(true);
    if (hasErrors(validateAuth(values, mode))) {
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
      const fields = serverFieldErrors(err, AUTH_SERVER_FIELDS);
      setServerErrors(fields);
      if (!hasErrors(fields)) {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const register = mode === 'register';
  return (
    <form className="auth-form" noValidate onSubmit={(e) => void submit(e)}>
      <h2>{register ? 'Create an account' : 'Sign in'}</h2>
      <p className="hint">Save home and work addresses and see the maps you looked at.</p>
      <Tabs
        label="Sign in or create an account"
        items={MODES}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(undefined);
          setServerErrors({});
          setSubmitted(false);
        }}
      />
      <TextField
        label="Email"
        type="email"
        autoComplete={register ? 'email' : 'username'}
        required
        value={email}
        error={errors.email}
        onChange={(e) => {
          setEmail(e.target.value);
          setServerErrors({});
        }}
      />
      {register && (
        <TextField
          label="Name (optional)"
          type="text"
          maxLength={80}
          autoComplete="nickname"
          value={displayName}
          error={errors.displayName}
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
        error={errors.password}
        onChange={(e) => {
          setPassword(e.target.value);
          setServerErrors({});
        }}
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
