import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureLogger } from '@heatmap/common/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadError, downloadToFile, hashFile } from './download.ts';

let dir: string;
let server: Server | undefined;
const { logger } = captureLogger('download');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function publisher(listener: RequestListener): Promise<string> {
  server = createServer(listener);
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/gtfs.zip`;
}

const get = (url: string, options: { maxBytes?: number; timeoutMs?: number; attempts?: number } = {}) =>
  downloadToFile(url, join(dir, 'out.zip'), { timeoutMs: 2_000, maxBytes: 1_000, logger, ...options });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'download-'));
});
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server === undefined ? r() : server.close(() => r())));
  server = undefined;
  await rm(dir, { recursive: true });
});

describe('download', () => {
  it('stores the body and reports its hash and size, following redirects', async () => {
    const url = await publisher((req, res) =>
      req.url === '/gtfs.zip' ? res.writeHead(302, { location: '/cdn' }).end() : res.end('archive'),
    );
    const done = await get(url);
    expect(done.sha256.toString('hex')).toBe(sha('archive'));
    expect(done.bytes).toBe(7);
    expect(await readFile(join(dir, 'out.zip'), 'utf8')).toBe('archive');
  });

  it('retries a 5xx answer and then succeeds', async () => {
    let calls = 0;
    const url = await publisher((_, res) => (++calls === 1 ? res.writeHead(503).end() : res.end('ok')));
    expect((await get(url)).bytes).toBe(2);
    expect(calls).toBe(2);
  });

  it('gives up after the allowed attempts', async () => {
    let calls = 0;
    const url = await publisher((_, res) => {
      calls++;
      res.writeHead(500).end();
    });
    await expect(get(url, { attempts: 2 })).rejects.toMatchObject({ name: 'DownloadError', status: 500 });
    expect(calls).toBe(2);
  });

  it('does not repeat a request the publisher refused', async () => {
    let calls = 0;
    const url = await publisher((_, res) => {
      calls++;
      res.writeHead(404).end();
    });
    await expect(get(url)).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);
  });

  it('stops an archive above the size limit at once, accepts one exactly at it', async () => {
    let calls = 0;
    const url = await publisher((_, res) => {
      calls++;
      res.end('x'.repeat(1_001));
    });
    await expect(get(url)).rejects.toThrow(/larger than 1000 bytes/);
    expect(calls).toBe(1);
    expect((await get(url, { maxBytes: 1_001 })).bytes).toBe(1_001);
  });

  it('reports a publisher that cannot be reached, or breaks off, as a download error', async () => {
    await expect(get('http://127.0.0.1:1/gtfs.zip', { attempts: 1 })).rejects.toBeInstanceOf(DownloadError);
    const url = await publisher((req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('half');
      setImmediate(() => req.socket.destroy());
    });
    await expect(get(url, { attempts: 1 })).rejects.toThrow(/download failed/);
  });

  it('times out on a publisher that does not answer', async () => {
    const url = await publisher(() => undefined);
    await expect(get(url, { attempts: 1, timeoutMs: 100 })).rejects.toThrow(/download failed/);
  });
});

describe('hash of a local file', () => {
  it('matches the content, also of an empty file', async () => {
    await writeFile(join(dir, 'a'), 'archive');
    await writeFile(join(dir, 'empty'), '');
    expect((await hashFile(join(dir, 'a'))).sha256.toString('hex')).toBe(sha('archive'));
    expect(await hashFile(join(dir, 'empty'))).toMatchObject({ bytes: 0 });
  });

  it('fails for a missing file', async () => {
    await expect(hashFile(join(dir, 'missing'))).rejects.toThrow(/ENOENT/);
  });
});
