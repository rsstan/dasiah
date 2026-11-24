import { afterEach, describe, expect, it } from 'vitest';
import { notifications } from '../notifications/store.ts';
import { ApiError } from './client.ts';
import { globalNotice } from './errorPolicy.ts';
import { createQueryClient } from './queryClient.ts';

const error = (status: number, title = 'x') => new ApiError(status, { title }, 'corr-123');

afterEach(() => notifications.setState({ notices: [] }));

describe('global error policy', () => {
  it('reports no connection, 5xx with the reference, 403 and 429', () => {
    expect(globalNotice(error(0))).toMatchObject({ title: 'No connection' });
    expect(globalNotice(error(500, 'Internal error'))).toMatchObject({ title: 'Server error', reference: 'corr-123' });
    expect(globalNotice(error(503))).toMatchObject({ title: 'Server error' });
    expect(globalNotice(error(403))).toMatchObject({ title: 'No access' });
    expect(globalNotice(error(429))).toMatchObject({ title: 'Slow down' });
    expect(globalNotice(new TypeError('boom'))).toMatchObject({ title: 'Something went wrong' });
  });

  it('leaves 401 to the session and 400/404/409/422 to the form or view', () => {
    for (const status of [401, 400, 404, 409, 422]) {
      expect(globalNotice(error(status))).toBeUndefined();
    }
  });

  it('turns a failed background load into a toast, unless the query is silent', async () => {
    const client = createQueryClient();
    const fail = async () => {
      throw error(500, 'Internal error');
    };
    await client.fetchQuery({ queryKey: ['a'], queryFn: fail, retry: false }).catch(() => undefined);
    expect(notifications.getState().notices.map((n) => n.title)).toEqual(['Server error']);

    notifications.setState({ notices: [] });
    await client
      .fetchQuery({ queryKey: ['b'], queryFn: fail, retry: false, meta: { silent: true } })
      .catch(() => undefined);
    expect(notifications.getState().notices).toEqual([]);
  });
});
