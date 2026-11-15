import { captureLogger } from '@heatmap/common/testing';
import { describe, expect, it } from 'vitest';
import { loadGatewayConfig } from './config.ts';
import { RateLimiter } from './rate-limit.ts';

const env = {
  SERVICE_NAME: 'gateway',
  PORT: '8080',
  IDENTITY_URL: 'http://identity:3001',
  TRANSIT_URL: 'http://transit-data:3002',
  ACCESSIBILITY_URL: 'http://accessibility:3003',
  PLACES_URL: 'http://places:3004',
  REDIS_URL: 'redis://redis:6379',
  WEB_ORIGIN: 'http://localhost:5173, https://heatmap.example',
};

describe('gateway configuration', () => {
  it('parses the origin list and applies defaults', () => {
    const config = loadGatewayConfig(env);
    expect(config.WEB_ORIGIN).toEqual(['http://localhost:5173', 'https://heatmap.example']);
    expect(config).toMatchObject({ UPSTREAM_TIMEOUT_MS: 10_000, ACCESSIBILITY_TIMEOUT_MS: 60_000, TRUST_PROXY: false });
  });

  it('rejects non-HTTP upstream URLs', () => {
    expect(() => loadGatewayConfig({ ...env, PLACES_URL: 'ftp://places' })).toThrow(/PLACES_URL/);
  });
});

describe('rate limiter', () => {
  it('allows within the limit and refuses above it', async () => {
    let count = 0;
    const limiter = new RateLimiter({ eval: async () => [++count, 42_000] }, 60, captureLogger().logger);
    expect(await limiter.hit('g', 'ip:1', 2)).toEqual({ allowed: true, limit: 2, remaining: 1, resetS: 42 });
    expect((await limiter.hit('g', 'ip:1', 2)).allowed).toBe(true);
    expect(await limiter.hit('g', 'ip:1', 2)).toEqual({ allowed: false, limit: 2, remaining: 0, resetS: 42 });
  });

  it('lets requests through and warns when Redis is unavailable', async () => {
    const { logger, lines } = captureLogger();
    const limiter = new RateLimiter(
      {
        eval: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
      60,
      logger,
    );
    expect((await limiter.hit('g', 'ip:1', 1)).allowed).toBe(true);
    expect(lines.at(-1)).toMatchObject({ level: 'warn', msg: 'rate limit store unavailable, request let through' });
  });
});
