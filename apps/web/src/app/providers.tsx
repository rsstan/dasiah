// Providers around the router: the TanStack Query client (server state). When the session ends
// (sign-out, account deleted, refresh refused), the signed-in user's cached data is dropped.
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { session } from '../features/auth/session.ts';
import { ME, queryClient } from '../shared/api/queryClient.ts';

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(
    () =>
      session.store.subscribe((now, before) => {
        if (before.state.kind === 'signed-in' && now.state.kind !== 'signed-in') {
          queryClient.removeQueries({ queryKey: [ME] });
        }
      }),
    [],
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
