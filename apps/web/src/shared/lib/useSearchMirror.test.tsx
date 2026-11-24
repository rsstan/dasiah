// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import { renderRoutes } from '../test/render.tsx';
import { useSearchMirror } from './useSearchMirror.ts';

function City() {
  const [search, setSearch] = useState('');
  useSearchMirror(search);
  return <button onClick={() => setSearch('?time=08%3A00')}>change</button>;
}
const routes = [
  { path: '/city', element: <City /> },
  { path: '/sign-in', element: <p>sign in</p> },
];

describe('useSearchMirror', () => {
  it('writes the query of its own page', async () => {
    const { router } = renderRoutes(routes, '/city');
    act(() => screen.getByRole('button').click());
    await waitFor(() => expect(router.state.location.search).toBe('?time=08%3A00'));
  });

  it('leaves the address alone once the router is on another page', async () => {
    const { router } = renderRoutes(routes, '/city');
    await act(async () => {
      const done = router.navigate('/sign-in?next=%2Fcity');
      expect(router.state.location.pathname).toBe('/sign-in'); // React still shows the city
      flushSync(() => screen.getByRole('button').click());
      await done;
    });
    expect(screen.getByText('sign in')).toBeDefined();
    expect(router.state.location.search).toBe('?next=%2Fcity');
  });
});
