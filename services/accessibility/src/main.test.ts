import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.ts';

describe('accessibility configuration', () => {
  it('stops on missing variables and parses the city list', () => {
    expect(() => loadServiceConfig({})).toThrow(/TRANSIT_URL: missing/);
    const config = loadServiceConfig({
      SERVICE_NAME: 'accessibility',
      PORT: '3003',
      DATABASE_URL: 'postgres://svc_accessibility:x@localhost/heatmap',
      AMQP_URL: 'amqp://u:p@localhost:5672',
      TRANSIT_URL: 'http://transit-data:3002',
      CITIES: 'vno, waw',
    });
    expect(config.CITIES).toEqual(['vno', 'waw']);
    expect(config.TIMETABLE_CACHE_SIZE).toBe(6);
  });
});
