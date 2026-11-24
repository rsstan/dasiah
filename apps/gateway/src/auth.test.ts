import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServiceUnavailableError, UnauthorizedError } from '@heatmap/common';
import { exportJWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Authenticator } from './auth.ts';

const USER = '0b6f3c1e-8a52-4d5e-9b1a-2f0c7d9e4a11';
const keys = generateKeyPairSync('ed25519');
let server: Server;
let identityUrl: string;

beforeAll(async () => {
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'EdDSA', use: 'sig' };
  server = createServer((req, res) =>
    req.url !== '/.well-known/jwks.json'
      ? res.writeHead(404).end()
      : res.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [jwk] })),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  identityUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const authenticator = (url = identityUrl) =>
  new Authenticator({ identityUrl: url, issuer: 'heatmap', audience: 'api' });

interface Parts {
  sub?: string;
  role?: unknown;
  issuer?: string;
  audience?: string;
  key?: KeyObject;
  kid?: string;
  expires?: string;
}
function token({ sub = USER, role = 'user', issuer = 'heatmap', audience = 'api', ...rest }: Parts = {}) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'EdDSA', kid: rest.kid ?? 'k1' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(rest.expires ?? '5m')
    .sign(rest.key ?? keys.privateKey);
}

describe('authenticator', () => {
  it('knows the caller of a valid token', async () => {
    expect(await authenticator().fromHeader(`Bearer ${await token({ role: 'admin' })}`)).toEqual({
      userId: USER,
      role: 'admin',
    });
  });

  it('treats a missing header as anonymous', async () => {
    expect(await authenticator().fromHeader(undefined)).toBeUndefined();
    expect(await authenticator().fromHeader('')).toBeUndefined();
  });

  it.each(['Basic abc', 'x Bearer abc', 'Bearer', 'Bearer ', 'bearer abc', 'Bearer a b', 'Bearer abc '])(
    'refuses the header %j',
    async (header) => {
      await expect(authenticator().fromHeader(header)).rejects.toThrow(/must be "Bearer <access token>"/);
    },
  );

  it.each<[string, Parts]>([
    ['another issuer', { issuer: 'other' }],
    ['another audience', { audience: 'other' }],
    ['another key', { key: generateKeyPairSync('ed25519').privateKey }],
    ['an unknown key id', { kid: 'k2' }],
    ['a subject that is no user id', { sub: 'admin' }],
    ['something before the user id', { sub: `x${USER}` }],
    ['something after the user id', { sub: `${USER}x` }],
    ['an unknown role', { role: 'root' }],
    ['no role', { role: null }],
  ])('refuses a token with %s', async (_, parts) => {
    await expect(authenticator().verify(await token(parts))).rejects.toMatchObject({
      status: 401,
      message: 'The access token is not valid.',
      type: '/problems/invalid-token',
    });
  });

  it('says when a token has expired', async () => {
    await expect(authenticator().verify(await token({ expires: '-1s' }))).rejects.toThrow(/expired/);
  });

  it('refuses an unsigned token and one that is no JWT', async () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', kid: 'k1' })}.${encode({ sub: USER, role: 'admin' })}.`;
    await expect(authenticator().verify(unsigned)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(authenticator().verify('abc')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('answers 503, not 401, while identity cannot be reached', async () => {
    await expect(authenticator('http://127.0.0.1:1').verify(await token())).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});
