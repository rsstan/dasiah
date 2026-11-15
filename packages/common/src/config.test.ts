import { describe, expect, it } from 'vitest';
import { baseConfigSchema, databaseConfigSchema, loadConfig } from './config.ts';
import { ConfigError } from './errors.ts';

const schema = baseConfigSchema.extend(databaseConfigSchema.shape);

describe('loadConfig', () => {
  it('parses, coerces and applies defaults', () => {
    const config = loadConfig(schema, {
      SERVICE_NAME: 'identity',
      PORT: '3001',
      DATABASE_URL: 'postgres://svc_identity:pw@localhost:5432/heatmap',
    });
    expect(config).toMatchObject({ SERVICE_NAME: 'identity', PORT: 3001, LOG_LEVEL: 'info', DB_POOL_MAX: 10 });
  });

  it('reports every problem at once, treats empty strings as missing, never echoes values', () => {
    let error: unknown;
    try {
      loadConfig(schema, { SERVICE_NAME: 'Bad Name', PORT: 'abc', DATABASE_URL: '', LOG_LEVEL: 'loud' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const issues = (error as ConfigError).issues.join('\n');
    expect(issues).toContain('SERVICE_NAME');
    expect(issues).toContain('PORT');
    expect(issues).toContain('DATABASE_URL: missing');
    expect(issues).toContain('LOG_LEVEL');
    expect(issues).not.toContain('loud');
    expect(issues).not.toContain('Bad Name');
  });
});
