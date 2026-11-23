import { afterEach, describe, expect, it } from 'vitest';
import { session } from '../features/auth/session.ts';
import { notifications } from '../shared/notifications/store.ts';
import { watchSessionEnd } from './providers.tsx';

const USER = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'ann@example.com',
  displayName: 'Ann',
  role: 'user' as const,
  locale: 'en' as const,
  createdAt: '2026-11-15T10:00:00Z',
};

afterEach(() => notifications.setState({ notices: [] }));

describe('end of a session (401)', () => {
  it('tells the user when the server ended the session, not when they signed out', () => {
    const stop = watchSessionEnd();
    session.store.setState({ state: { kind: 'signed-in', user: USER } });
    session.store.setState({ state: { kind: 'signed-out' }, ended: 'expired' });
    expect(notifications.getState().notices[0]).toMatchObject({ title: 'Signed out' });

    notifications.setState({ notices: [] });
    session.store.setState({ state: { kind: 'signed-in', user: USER } });
    session.store.setState({ state: { kind: 'signed-out' }, ended: 'signed-out' });
    expect(notifications.getState().notices).toEqual([]);
    stop();
  });
});
