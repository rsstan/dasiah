import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.ts';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('identity configuration', () => {
  it('stops on missing variables', () => {
    expect(() => loadServiceConfig({})).toThrow(/JWT_PRIVATE_KEY: missing/);
  });

  it('accepts a one-line PEM with \\n escapes and applies defaults', () => {
    const config = loadServiceConfig({
      SERVICE_NAME: 'identity',
      PORT: '3001',
      DATABASE_URL: 'postgres://svc_identity:x@localhost/heatmap',
      AMQP_URL: 'amqp://u:p@localhost:5672',
      JWT_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
      JWT_KEY_ID: 'k1',
      COOKIE_SECURE: 'false',
    });
    expect(config.JWT_PRIVATE_KEY).toBe(pem);
    expect(config).toMatchObject({ ACCESS_TTL_S: 900, COOKIE_SECURE: false, LOGIN_MAX_FAILURES: 5, TRUST_PROXY: true });
  });
});
