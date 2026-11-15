import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../api/client.ts';
import { addressOf } from '../account/SavePlaceForm.tsx';
import { Session } from './session.ts';

const USER = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'ann@example.com',
  displayName: 'Ann',
  role: 'user',
  locale: 'en',
  createdAt: '2026-11-15T10:00:00Z',
};
const tokens = (n: number) => ({ accessToken: `token-${n}`, tokenType: 'Bearer', expiresIn: 900 });

type Handler = (url: string, init: RequestInit) => [number, unknown];
function stubServer(handler: Handler) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)['authorization'];
      calls.push(`${init.method} ${url}${auth === undefined ? '' : ` [${auth}]`}`);
      await new Promise((r) => setTimeout(r, 5));
      const [status, body] = handler(url, init);
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Session', () => {
  it('stays signed out when there is no refresh cookie', async () => {
    stubServer(() => [401, { type: '/problems/invalid-refresh-token', status: 401 }]);
    const s = new Session();
    await s.restore();
    expect(s.getState()).toEqual({ kind: 'signed-out' });
  });

  it('signs in, then sends the access token with every request', async () => {
    const calls = stubServer((url) =>
      url.endsWith('/auth/login') ? [200, tokens(1)] : [200, url.endsWith('/users/me') ? USER : { items: [] }],
    );
    const s = new Session();
    await s.signIn('ann@example.com', 'correct horse battery');
    expect(s.getState()).toEqual({ kind: 'signed-in', user: USER });
    await request('/places');
    expect(calls).toEqual([
      'POST /api/v1/auth/login',
      'GET /api/v1/users/me [Bearer token-1]',
      'GET /api/v1/places [Bearer token-1]',
    ]);
  });

  it('refreshes once on 401 and retries; parallel 401s share one refresh', async () => {
    let refreshed = 0;
    const calls = stubServer((url, init) => {
      const auth = (init.headers as Record<string, string>)['authorization'];
      if (url.endsWith('/auth/login')) return [200, tokens(1)];
      if (url.endsWith('/auth/refresh')) return [200, tokens(2 + refreshed++)];
      if (url.endsWith('/users/me')) return [200, USER];
      return auth === 'Bearer token-1' ? [401, { status: 401 }] : [200, { items: [] }];
    });
    const s = new Session();
    await s.signIn('ann@example.com', 'correct horse battery');
    await Promise.all([request('/places'), request('/history')]);
    expect(refreshed).toBe(1);
    expect(calls.filter((c) => c.includes('[Bearer token-2]')).sort()).toEqual([
      'GET /api/v1/history [Bearer token-2]',
      'GET /api/v1/places [Bearer token-2]',
    ]);
  });

  it('signs out when the refresh token is refused (expired or revoked)', async () => {
    stubServer((url) => {
      if (url.endsWith('/auth/login')) return [200, tokens(1)];
      if (url.endsWith('/users/me')) return [200, USER];
      return [401, { status: 401 }];
    });
    const s = new Session();
    await s.signIn('ann@example.com', 'correct horse battery');
    await expect(request('/places')).rejects.toMatchObject({ status: 401 });
    expect(s.getState()).toEqual({ kind: 'signed-out' });
  });

  it('keeps the user signed in when the refresh fails for a network reason', async () => {
    let down = false;
    stubServer((url) => {
      if (down) return [503, { status: 503 }];
      if (url.endsWith('/auth/login')) return [200, tokens(1)];
      return [200, USER];
    });
    const s = new Session();
    await s.signIn('ann@example.com', 'correct horse battery');
    down = true;
    expect(await s.refresh()).toBe(true);
    expect(s.getState().kind).toBe('signed-in');
  });

  it('refreshes the access token a minute before it expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls = stubServer((url) =>
      url.endsWith('/auth/refresh') ? [200, tokens(2)] : url.endsWith('/auth/login') ? [200, tokens(1)] : [200, USER],
    );
    const s = new Session();
    const signedIn = s.signIn('ann@example.com', 'correct horse battery');
    await vi.advanceTimersByTimeAsync(50);
    await signedIn;
    expect(calls.some((c) => c.includes('/auth/refresh'))).toBe(false);
    await vi.advanceTimersByTimeAsync(840_000 + 50);
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('signs out locally even when the server is unreachable, and clears the token', async () => {
    const calls = stubServer((url) =>
      url.endsWith('/auth/logout')
        ? [503, { status: 503 }]
        : url.endsWith('/auth/login')
          ? [200, tokens(1)]
          : [200, USER],
    );
    const s = new Session();
    await s.signIn('ann@example.com', 'correct horse battery');
    await s.signOut();
    expect(s.getState()).toEqual({ kind: 'signed-out' });
    await request('/legend');
    expect(calls.at(-1)).toBe('GET /api/v1/legend');
  });
});

describe('addressOf', () => {
  it('uses the geocoded address, else the coordinates', () => {
    expect(addressOf({ lat: 54.687, lon: 25.28, label: 'x', address: 'Gedimino pr. 9, Vilnius' })).toBe(
      'Gedimino pr. 9, Vilnius',
    );
    expect(addressOf({ lat: 54.687123456, lon: 25.28, label: 'Point on the map' })).toBe('54.68712, 25.28000');
  });
});
