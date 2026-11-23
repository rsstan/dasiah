// Providers around the router: the error boundary of the whole application, the TanStack Query
// client (server state) and the toasts. When the session ends, the signed-in user's cached data
// is dropped; when it ends without the user asking (refresh refused), a toast says so.
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { session } from '../features/auth/session.ts';
import { ME, queryClient } from '../shared/api/queryClient.ts';
import { logger } from '../shared/lib/logger.ts';
import { notify } from '../shared/notifications/store.ts';
import { Toaster } from '../shared/ui/index.ts';
import { AppErrorBoundary } from './ErrorBoundary.tsx';

/** Reacts to the end of a session (exported for tests). */
export function watchSessionEnd(): () => void {
  return session.store.subscribe((now, before) => {
    if (before.state.kind === 'signed-in' && now.state.kind !== 'signed-in') {
      queryClient.removeQueries({ queryKey: [ME] });
      if (now.ended === 'expired') {
        logger.info('session ended by the server');
        notify({ tone: 'info', title: 'Signed out', message: 'Your session has ended. Sign in again to continue.' });
      }
    }
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => watchSessionEnd(), []);
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
