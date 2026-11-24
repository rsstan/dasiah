import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { hashRefreshToken, newRefreshToken, TokenIssuer } from './tokens.ts';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const settings = { privateKeyPem: pem, keyId: 'k1', issuer: 'heatmap', audience: 'api', accessTtlS: 900 };
const claims = { userId: '0b6f3c1e-8a52-4d5e-9b1a-2f0c7d9e4a11', role: 'user' as const };
const verify = (token: string, options = {}) =>
  jwtVerify(token, createPublicKey(pem), { issuer: 'heatmap', audience: 'api', ...options });

describe('access tokens', () => {
  it('carry subject, role and lifetime and are signed with EdDSA and the key id', async () => {
    const token = await new TokenIssuer(settings).issueAccessToken(claims);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'EdDSA', kid: 'k1', typ: 'JWT' });
    const { payload } = await verify(token);
    expect(payload).toMatchObject({ sub: claims.userId, role: 'user' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
  });

  it('are never the same twice', async () => {
    const issuer = new TokenIssuer(settings);
    const [a, b] = await Promise.all([issuer.issueAccessToken(claims), issuer.issueAccessToken(claims)]);
    expect(a).not.toBe(b);
  });

  it('do not verify for another audience or issuer, with a changed payload or after they expired', async () => {
    const token = await new TokenIssuer(settings).issueAccessToken(claims);
    await expect(verify(token, { audience: 'other' })).rejects.toThrow();
    await expect(verify(token, { issuer: 'other' })).rejects.toThrow();
    const [head, body, signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), role: 'admin' }),
    ).toString('base64url');
    await expect(verify(`${head}.${forged}.${signature}`)).rejects.toThrow(/signature/);
    await expect(verify(token, { currentDate: new Date(Date.now() + 901_000) })).rejects.toThrow(/exp/);
  });

  it('refuses a key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => new TokenIssuer({ ...settings, privateKeyPem: rsa })).toThrow(/Ed25519/);
  });

  it('publishes only the public half of the key', async () => {
    const { keys } = await new TokenIssuer(settings).jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'k1', alg: 'EdDSA', use: 'sig' });
    expect(keys[0]).not.toHaveProperty('d');
    expect(keys[0]?.x).toBe(createPublicKey(pem).export({ format: 'jwk' }).x);
  });
});

describe('refresh tokens', () => {
  it('are 256 random bits of which only the SHA-256 is stored', () => {
    const { token, hash } = newRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toHaveLength(32);
    expect(hashRefreshToken(token).equals(hash)).toBe(true);
    expect(newRefreshToken().token).not.toBe(token);
  });

  it('hash to the known SHA-256 value', () => {
    expect(new TokenIssuer(settings).accessTtlS).toBe(900);
    expect(hashRefreshToken('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
