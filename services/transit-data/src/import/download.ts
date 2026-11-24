// Download of a GTFS archive to a local file with its SHA-256 computed on the way: timeout,
// size limit, retries with backoff for network errors and 5xx (a GET is safe to repeat).
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Logger } from '@heatmap/common';
import { Agent, interceptors, request } from 'undici';

/** Publishers often redirect to a CDN. */
const dispatcher = new Agent().compose(interceptors.redirect({ maxRedirections: 5 }));

export class DownloadError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DownloadError';
    this.status = status;
  }
}

export interface Downloaded {
  readonly sha256: Buffer;
  readonly bytes: number;
}

function hashingStream(maxBytes: number, onDone: (sha: Buffer, bytes: number) => void): Transform {
  const hash = createHash('sha256');
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (maxBytes > 0 && bytes > maxBytes) {
        callback(new DownloadError(`archive larger than ${maxBytes} bytes`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      onDone(hash.digest(), bytes);
      callback();
    },
  });
}

export async function downloadToFile(
  url: string,
  file: string,
  /** timeoutMs: without any data from the publisher, not for the whole download. maxBytes: 0 = no limit. */
  options: { timeoutMs: number; maxBytes: number; logger: Logger; attempts?: number },
): Promise<Downloaded> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await request(url, {
        method: 'GET',
        headers: { 'user-agent': 'transit-heatmap/1.0 (GTFS import)', accept: 'application/zip, */*' },
        headersTimeout: options.timeoutMs,
        bodyTimeout: options.timeoutMs,
        dispatcher,
      });
      if (response.statusCode !== 200) {
        await response.body.dump();
        throw new DownloadError(`publisher answered ${response.statusCode}`, response.statusCode);
      }
      let result: Downloaded | undefined;
      await pipeline(
        response.body,
        hashingStream(options.maxBytes, (sha256, bytes) => (result = { sha256, bytes })),
        createWriteStream(file),
      );
      if (result === undefined) {
        throw new DownloadError('download ended without data');
      }
      return result;
    } catch (error) {
      const status = error instanceof DownloadError ? error.status : undefined;
      const retryable = status === undefined ? !(error instanceof DownloadError) : status >= 500;
      if (!retryable || attempt >= attempts) {
        throw error instanceof DownloadError
          ? error
          : new DownloadError(`download failed: ${error instanceof Error ? error.message : String(error)}`, undefined, {
              cause: error,
            });
      }
      const delay = 500 * 2 ** (attempt - 1) * (0.5 + Math.random());
      options.logger.warn({ attempt, delay_ms: Math.round(delay), err: error }, 'download failed, retrying');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** SHA-256 and size of a local file (imports from disk). */
export async function hashFile(file: string): Promise<Downloaded> {
  let result: Downloaded | undefined;
  await pipeline(
    createReadStream(file),
    hashingStream(0, (sha256, bytes) => (result = { sha256, bytes })),
    new Writable({
      write(_chunk, _encoding, callback) {
        callback(); // only hashing
      },
    }),
  );
  if (result === undefined) {
    throw new Error(`could not read ${file}`);
  }
  return result;
}
