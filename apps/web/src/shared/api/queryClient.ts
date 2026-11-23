// Server state: one TanStack Query client for the application. Requests go through the API
// client (shared/api/client.ts); queries add caching, de-duplication, retries and the common
// loading/error states. Keys of the signed-in user's data start with ME, so they can be dropped
// in one call when the session ends.
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.ts';

export const ME = 'me';

/** Retry only what may succeed later: network failures and 5xx, twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
