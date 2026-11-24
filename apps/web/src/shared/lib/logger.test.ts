import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from './logger.ts';

afterEach(() => vi.restoreAllMocks());

describe('logger', () => {
  it('prints from its minimum level and keeps the latest entries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const log = new Logger('warn');
    log.debug('hidden', { a: 1 });
    log.warn('request failed', { status: 503, correlationId: 'c-1' });
    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[heatmap] request failed', { status: 503, correlationId: 'c-1' });
    expect(log.recent().map((e) => e.level)).toEqual(['debug', 'warn']);
    for (let i = 0; i < 60; i++) log.debug(`m${i}`);
    expect(log.recent()).toHaveLength(50);
  });
});
