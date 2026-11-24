// Which failed requests the whole application reports (as a toast), and how. Errors that belong
// to a form or a view (400, 404, 409, 422) are shown there; 401 is handled by the session
// (token refresh, then "sign in again"). Reported globally: no connection, 5xx with the
// reference to quote, 403 and rate limiting.
import type { Notice } from '../notifications/store.ts';
import { ApiError, describeError } from './client.ts';

export type GlobalNotice = Omit<Notice, 'id'>;

export function globalNotice(error: unknown): GlobalNotice | undefined {
  if (!(error instanceof ApiError)) {
    return { tone: 'error', title: 'Something went wrong', message: 'An unexpected error occurred.' };
  }
  const reference = error.correlationId === '' ? undefined : error.correlationId;
  if (error.status === 0) {
    return { tone: 'error', title: 'No connection', message: describeError(error) };
  }
  if (error.status >= 500) {
    return { tone: 'error', title: 'Server error', message: describeError(error), reference };
  }
  if (error.status === 403) {
    return { tone: 'error', title: 'No access', message: 'Your account is not allowed to do this.', reference };
  }
  if (error.status === 429) {
    return { tone: 'error', title: 'Slow down', message: describeError(error) };
  }
  return undefined;
}
