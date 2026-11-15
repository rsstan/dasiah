// Helpers for tests of code built on this package.
import { Writable } from 'node:stream';
import { createLogger, type Logger } from './logger.ts';

export interface CapturedLogger {
  readonly logger: Logger;
  /** Parsed JSON log lines written so far. */
  readonly lines: Record<string, unknown>[];
}

/** A real pino logger whose output is kept in memory. */
export function captureLogger(service = 'test', level = 'debug'): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        }
      }
      callback();
    },
  });
  return { logger: createLogger({ service, level, destination }), lines };
}
