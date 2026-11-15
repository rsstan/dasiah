// identity end to end against a real database (bootstrap, migrations, svc_identity role) and
// RabbitMQ: register, sign in, rotation and reuse detection, expiry, sign-out, profile,
// password change, lockout, erasure with its event; no secret in any response or log line.
import { generateKeyPairSync } from 'node:crypto';
import type { LightMyRequestResponse } from '@heatmap/common';
import { captureLogger } from '@heatmap/common/testing';
import { startBroker, startDatabase, type TestBroker, type TestDatabase } from '@heatmap/testing';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdentityService, type IdentityService } from './app.ts';
import { loadServiceConfig } from './config.ts';

let db: TestDatabase;
let broker: TestBroker;
let service: IdentityService;
let nextDeleted: Awaited<ReturnType<TestBroker['listen']>>;
const captured = captureLogger('identity');
/** Everything the service sent back, checked for secrets at the end. */
const responses: LightMyRequestResponse[] = [];
/** Every password and refresh token used in the tests. */
const secrets = new Set<string>();

const PASSWORD = 'correct horse battery staple';
const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

interface CallOptions {
  body?: unknown;
  userId?: string;
  cookie?: string;
  correlationId?: string;
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'itest' };
  if (options.userId !== undefined) {
    headers['x-user-id'] = options.userId;
    headers['x-user-role'] = 'user';
  }
  if (options.cookie !== undefined) {
    headers['cookie'] = `refresh_token=${options.cookie}`;
  }
  if (options.correlationId !== undefined) {
    headers['x-correlation-id'] = options.correlationId;
  }
  const response = await service.app.inject({
    method,
    url,
    headers,
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
  responses.push(response);
  return response;
}

function refreshCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === 'refresh_token');
  if (cookie === undefined || cookie.value === '') {
    throw new Error(`no refresh cookie in ${response.statusCode} ${response.body}`);
  }
  secrets.add(cookie.value);
  return cookie.value;
}

async function registerAndLogin(email: string, password = PASSWORD) {
  secrets.add(password);
  const registered = await call('POST', '/auth/register', { body: { email, password, displayName: 'Test User' } });
  expect(registered.statusCode).toBe(201);
  const loggedIn = await call('POST', '/auth/login', { body: { email, password } });
  expect(loggedIn.statusCode).toBe(200);
  return {
    userId: registered.json<{ userId: string }>().userId,
    accessToken: loggedIn.json<{ accessToken: string }>().accessToken,
    cookie: refreshCookie(loggedIn),
  };
}

async function auditCodes(userId: string): Promise<string[]> {
  const { rows } = await db.admin.query<{ code: string }>(
    `SELECT t.code FROM identity.audit_log a JOIN identity.audit_event_types t USING (event_type_id)
      WHERE a.user_id = $1 ORDER BY a.audit_id`,
    [userId],
  );
  return rows.map((r) => r.code);
}

beforeAll(async () => {
  [db, broker] = await Promise.all([
    startDatabase({ services: ['identity'], referenceData: ['identity'] }),
    startBroker(),
  ]);
  nextDeleted = await broker.listen('identity.user.deleted.v1');
  const config = loadServiceConfig({
    SERVICE_NAME: 'identity',
    PORT: '3001', // not listening: requests go through inject()
    LOG_LEVEL: 'debug',
    DATABASE_URL: db.url('svc_identity'),
    AMQP_URL: broker.url,
    JWT_PRIVATE_KEY: pem,
    JWT_KEY_ID: 'test-key',
    LOGIN_MAX_FAILURES: '3',
    LOGIN_LOCK_WINDOW_S: '120',
  });
  service = await createIdentityService(config, captured.logger);
  await service.app.ready();
});

afterAll(async () => {
  await service?.app.close();
  await Promise.all([db?.stop(), broker?.stop()]);
});

describe('registration', () => {
  it('creates an account and refuses the same email in another case', async () => {
    secrets.add(PASSWORD);
    const res = await call('POST', '/auth/register', {
      body: { email: 'Ann.Smith@example.com', password: PASSWORD, locale: 'pl' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['location']).toBe('/api/v1/users/me');
    expect(res.json()).toMatchObject({ email: 'Ann.Smith@example.com', displayName: null, role: 'user', locale: 'pl' });
    expect(Object.keys(res.json()).sort()).toEqual(['createdAt', 'displayName', 'email', 'locale', 'role', 'userId']);

    const dup = await call('POST', '/auth/register', { body: { email: 'ann.smith@EXAMPLE.com', password: PASSWORD } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ type: '/problems/email-taken', status: 409 });
  });

  it('validates the request against the contract', async () => {
    const res = await call('POST', '/auth/register', {
      body: { email: 'not-an-email', password: 'short', admin: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['/body/email', '/body/password', '/body']),
    );
  });
});

describe('sign-in and tokens', () => {
  it('issues an EdDSA access token verifiable with the JWKS and a strict refresh cookie', async () => {
    const { userId, accessToken } = await registerAndLogin('bob@example.com');
    const jwks = await call('GET', '/.well-known/jwks.json');
    expect(jwks.headers['cache-control']).toBe('public, max-age=300');
    expect(jwks.json().keys[0]).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
      kid: 'test-key',
      alg: 'EdDSA',
      use: 'sig',
    });
    const { payload, protectedHeader } = await jwtVerify(accessToken, createLocalJWKSet(jwks.json()), {
      issuer: 'heatmap-identity',
      audience: 'heatmap',
    });
    expect(protectedHeader).toMatchObject({ alg: 'EdDSA', kid: 'test-key' });
    expect(payload).toMatchObject({ sub: userId, role: 'user' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);

    const login = responses.at(-2);
    const cookie = login?.cookies.find((c) => c.name === 'refresh_token');
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/v1/auth',
      maxAge: 2_592_000,
    });
    const stored = await db.admin.query(
      `SELECT octet_length(token_hash) AS len, ip::text, user_agent FROM identity.refresh_tokens WHERE user_id = $1`,
      [userId],
    );
    expect(stored.rows).toEqual([{ len: 32, ip: '203.0.113.9/32', user_agent: 'itest' }]);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const wrong = await call('POST', '/auth/login', {
      body: { email: 'bob@example.com', password: 'wrong password!' },
    });
    const unknown = await call('POST', '/auth/login', {
      body: { email: 'nobody@example.com', password: 'whatever pw' },
    });
    secrets.add('wrong password!').add('whatever pw');
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        type: '/problems/invalid-credentials',
        detail: 'Email or password is wrong.',
      });
      expect(res.cookies).toEqual([]);
    }
  });

  it('rotates the refresh token and treats a replayed one as theft', async () => {
    const { userId, cookie: first } = await registerAndLogin('carol@example.com');
    const rotated = await call('POST', '/auth/refresh', { cookie: first });
    expect(rotated.statusCode).toBe(200);
    const second = refreshCookie(rotated);
    expect(second).not.toBe(first);

    const replay = await call('POST', '/auth/refresh', { cookie: first });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ type: '/problems/invalid-refresh-token' });
    expect(replay.cookies.find((c) => c.name === 'refresh_token')?.value).toBe('');
    // The legitimate holder of the newer token is signed out too.
    expect((await call('POST', '/auth/refresh', { cookie: second })).statusCode).toBe(401);
    expect(await auditCodes(userId)).toContain('refresh_token_reused');
    const live = await db.admin.query(
      `SELECT count(*)::int AS n FROM identity.refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    expect(live.rows[0]).toEqual({ n: 0 });
  });

  it('refuses an expired refresh token and a missing one', async () => {
    const { userId, cookie } = await registerAndLogin('dave@example.com');
    await db.admin.query(
      `UPDATE identity.refresh_tokens SET issued_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = $1`,
      [userId],
    );
    const expired = await call('POST', '/auth/refresh', { cookie });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().detail).toBe('The session has expired. Sign in again.');
    expect((await call('POST', '/auth/refresh')).statusCode).toBe(401);
  });

  it('signs out: the refresh token stops working', async () => {
    const { userId, cookie } = await registerAndLogin('erin@example.com');
    const out = await call('POST', '/auth/logout', { userId, cookie });
    expect(out.statusCode).toBe(204);
    expect((await call('POST', '/auth/refresh', { cookie })).statusCode).toBe(401);
  });
});

describe('own account', () => {
  it('needs the caller set by the gateway', async () => {
    const res = await call('GET', '/users/me');
    expect(res.statusCode).toBe(401);
  });

  it('reads and changes the profile', async () => {
    const { userId } = await registerAndLogin('frank@example.com');
    expect((await call('GET', '/users/me', { userId })).json()).toMatchObject({ userId, displayName: 'Test User' });
    const changed = await call('PATCH', '/users/me', { userId, body: { displayName: null, locale: 'lt' } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ displayName: null, locale: 'lt' });
    expect(await auditCodes(userId)).toContain('profile_updated');
  });

  it('changes the password: wrong current password refused, every old session ends', async () => {
    const { userId, cookie } = await registerAndLogin('grace@example.com');
    const newPassword = 'a much better passphrase';
    secrets.add(newPassword);
    const wrong = await call('POST', '/users/me/password', {
      userId,
      body: { currentPassword: 'nope nope', newPassword },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ type: '/problems/wrong-password' });

    const ok = await call('POST', '/users/me/password', { userId, body: { currentPassword: PASSWORD, newPassword } });
    expect(ok.statusCode).toBe(200);
    const fresh = refreshCookie(ok);
    expect((await call('POST', '/auth/refresh', { cookie })).statusCode).toBe(401);
    expect((await call('POST', '/auth/refresh', { cookie: fresh })).statusCode).toBe(200);
    expect(
      (await call('POST', '/auth/login', { body: { email: 'grace@example.com', password: PASSWORD } })).statusCode,
    ).toBe(401);
    expect(
      (await call('POST', '/auth/login', { body: { email: 'grace@example.com', password: newPassword } })).statusCode,
    ).toBe(200);
    expect(await auditCodes(userId)).toContain('password_changed');
  });

  it('erases the account, ends its sessions and publishes identity.user.deleted.v1', async () => {
    const { userId, cookie } = await registerAndLogin('heidi@example.com');
    const res = await call('DELETE', '/users/me', { userId, correlationId: 'corr-delete-1' });
    expect(res.statusCode).toBe(204);

    const event = await nextDeleted();
    expect(event.body).toMatchObject({
      type: 'identity.user.deleted.v1',
      source: 'identity',
      correlationId: 'corr-delete-1',
      data: { userId },
    });
    expect(event.properties.headers?.['x-correlation-id']).toBe('corr-delete-1');

    const row = await db.admin.query(
      `SELECT email::text, display_name, deleted_at IS NOT NULL AS deleted FROM identity.users WHERE user_id = $1`,
      [userId],
    );
    expect(row.rows[0]).toEqual({ email: `deleted-${userId}@invalid.example`, display_name: null, deleted: true });
    expect((await call('GET', '/users/me', { userId })).statusCode).toBe(404);
    expect((await call('DELETE', '/users/me', { userId })).statusCode).toBe(404);
    expect((await call('POST', '/auth/refresh', { cookie })).statusCode).toBe(401);
    expect(
      (await call('POST', '/auth/login', { body: { email: 'heidi@example.com', password: PASSWORD } })).statusCode,
    ).toBe(401);
    expect(await auditCodes(userId)).toContain('user_anonymized');
  });
});

describe('repeated failures', () => {
  it('locks the account after 3 failures, even for the right password, with Retry-After', async () => {
    const { userId } = await registerAndLogin('ivan@example.com');
    for (let i = 0; i < 3; i++) {
      const res = await call('POST', '/auth/login', {
        body: { email: 'ivan@example.com', password: `guess number ${i}` },
      });
      secrets.add(`guess number ${i}`);
      expect(res.statusCode).toBe(401);
    }
    const locked = await call('POST', '/auth/login', { body: { email: 'ivan@example.com', password: PASSWORD } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ type: '/problems/account-locked', status: 429 });
    const retryAfter = Number(locked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(100);
    expect(retryAfter).toBeLessThanOrEqual(120);
    expect(await auditCodes(userId)).toEqual(
      expect.arrayContaining(['user_registered', 'login_succeeded', 'login_failed', 'login_locked']),
    );
    const failedIps = await db.admin.query(
      `SELECT DISTINCT ip::text FROM identity.audit_log WHERE user_id = $1 AND ip IS NOT NULL`,
      [userId],
    );
    expect(failedIps.rows).toEqual([{ ip: '203.0.113.9/32' }]);
  });
});

describe('secrets never leave the service', () => {
  it('no response or log line contains a password, a password hash or a refresh token', async () => {
    const { rows } = await db.admin.query<{ password_hash: string }>('SELECT password_hash FROM identity.users');
    const hashes = rows.map((r) => r.password_hash).filter((h) => h !== '$argon2id$disabled');
    expect(hashes.length).toBeGreaterThan(5);
    const forbidden = [...secrets, ...hashes, ...hashes.map((h) => h.split('$').at(-1) ?? h)];

    for (const res of responses) {
      const { 'set-cookie': _cookie, ...headers } = res.headers;
      const visible = `${res.body}\n${JSON.stringify(headers)}`;
      for (const secret of forbidden) {
        expect(visible.includes(secret), `response ${res.statusCode} contains a secret`).toBe(false);
      }
    }
    expect(captured.lines.length).toBeGreaterThan(50);
    const logs = captured.lines.map((l) => JSON.stringify(l)).join('\n');
    for (const secret of forbidden) {
      expect(logs.includes(secret), 'a log line contains a secret').toBe(false);
    }
    // Every request log line carries a correlation id.
    const completed = captured.lines.filter((l) => l['msg'] === 'request completed');
    expect(completed.length).toBe(responses.length);
    expect(completed.every((l) => typeof l['correlation_id'] === 'string')).toBe(true);
  });
});
