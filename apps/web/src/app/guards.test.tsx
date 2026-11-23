// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { session, type SessionState } from '../features/auth/index.ts';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { renderRoutes } from '../shared/test/render.tsx';
import { RequireAdmin, RequireAuth } from './guards.tsx';

const user = (role: 'user' | 'admin'): SessionState => ({
  kind: 'signed-in',
  user: {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'ann@example.com',
    displayName: 'Ann',
    role,
    locale: 'en',
    createdAt: '2026-11-15T10:00:00Z',
  },
});

const routes = [
  { path: '/', element: <h1>Cities</h1> },
  { path: '/sign-in', element: <h1>Sign in page</h1> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/places', element: <h1>Places page</h1> },
      {
        path: '/admin',
        element: (
          <RequireAdmin>
            <h1>Admin page</h1>
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

const setSession = (state: SessionState) => act(() => session.store.setState({ state }));

afterEach(() => session.store.setState({ state: { kind: 'unknown' } }));

describe('route guards', () => {
  it('waits for the session before deciding', () => {
    setSession({ kind: 'unknown' });
    renderRoutes(routes, '/places');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Places page' })).toBeNull();
  });

  it('sends a signed-out visitor to sign-in with the way back', () => {
    setSession({ kind: 'signed-out' });
    const { router } = renderRoutes(routes, '/places?sort=name');
    expect(screen.getByRole('heading', { name: 'Sign in page' })).toBeTruthy();
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
      '/sign-in?next=%2Fplaces%3Fsort%3Dname',
    );
  });

  it('shows the page to a signed-in user and goes to the map when the session ends', () => {
    setSession(user('user'));
    const { router } = renderRoutes(routes, '/places');
    expect(screen.getByRole('heading', { name: 'Places page' })).toBeTruthy();
    setSession({ kind: 'signed-out' });
    expect(router.state.location.pathname).toBe('/');
  });

  it('answers 403 to a user on the admin page and lets an admin in', () => {
    setSession(user('user'));
    renderRoutes(routes, '/admin');
    expect(screen.getByRole('heading', { name: 'No access' })).toBeTruthy();
    expect(screen.getByText('403')).toBeTruthy();
  });

  it('lets an admin into the admin page', () => {
    setSession(user('admin'));
    renderRoutes(routes, '/admin');
    expect(screen.getByRole('heading', { name: 'Admin page' })).toBeTruthy();
  });

  it('answers 404 to an unknown address', () => {
    renderRoutes(routes, '/no/such/page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByText('/no/such/page')).toBeTruthy();
  });
});
