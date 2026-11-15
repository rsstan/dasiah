import { describe, expect, it } from 'vitest';
import { runWithContext } from './context.ts';
import { captureLogger } from './test-support.ts';

describe('logger', () => {
  it('writes the required fields', () => {
    const { logger, lines } = captureLogger('identity');
    logger.info('hello');
    expect(lines[0]).toMatchObject({ level: 'info', service: 'identity', msg: 'hello' });
    expect(String(lines[0]?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('adds the correlation id of the current context', () => {
    const { logger, lines } = captureLogger();
    runWithContext({ correlationId: 'abc-123' }, () => logger.info('inside'));
    logger.info('outside');
    expect(lines[0]).toMatchObject({ correlation_id: 'abc-123' });
    expect(lines[1]).not.toHaveProperty('correlation_id');
  });

  it('redacts secrets and personal data at any depth', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        password: 'p1',
        body: { email: 'a@example.com', newPassword: 'p2', addressText: '1 Main St' },
        req: { headers: { authorization: 'Bearer x', cookie: 'refresh_token=y', 'user-agent': 'ua' } },
        nested: { deeper: { accessToken: 'jwt' } },
      },
      'login',
    );
    const text = JSON.stringify(lines[0]);
    for (const secret of ['p1', 'p2', 'a@example.com', '1 Main St', 'Bearer x', 'refresh_token=y', 'jwt']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('ua');
  });
});
