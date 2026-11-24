import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.ts';

describe('transit-data configuration', () => {
  it('stops on missing variables and applies defaults', () => {
    expect(() => loadServiceConfig({})).toThrow(/DATABASE_URL: missing/);
    const config = loadServiceConfig({
      SERVICE_NAME: 'transit-data',
      PORT: '3002',
      DATABASE_URL: 'postgres://svc_transit:x@localhost/heatmap',
      AMQP_URL: 'amqp://u:p@localhost:5672',
    });
    expect(config).toMatchObject({
      STORAGE_DRIVER: 'fs',
      IMPORT_STATEMENT_TIMEOUT_MS: 0,
      MAX_STOPS_OUTSIDE_SHARE: 1,
    });
  });
});
