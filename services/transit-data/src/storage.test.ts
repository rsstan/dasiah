import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsStorage } from './storage.ts';

let dir: string;
let storage: FsStorage;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'storage-'));
  storage = new FsStorage(dir);
});
afterEach(() => rm(dir, { recursive: true }));

describe('file storage', () => {
  it('stores buffers and files under nested keys and reads them back', async () => {
    await storage.putBuffer('artifacts/1/a.json', Buffer.from('one'));
    expect((await storage.getBuffer('artifacts/1/a.json'))?.toString()).toBe('one');
    await writeFile(join(dir, 'src'), 'two');
    await storage.putFile('raw/b.zip', join(dir, 'src'));
    expect(await text(storage.stream('raw/b.zip'))).toBe('two');
    expect(await storage.exists('raw/b.zip')).toBe(true);
  });

  it('replaces an object and leaves no partial file behind', async () => {
    await storage.putBuffer('k/a', Buffer.from('old'));
    await storage.putBuffer('k/a', Buffer.from('new'));
    expect((await storage.getBuffer('k/a'))?.toString()).toBe('new');
    expect(await readdir(join(dir, 'k'))).toEqual(['a']);
  });

  it('knows missing objects from other errors', async () => {
    expect(await storage.getBuffer('none')).toBeUndefined();
    expect(await storage.exists('none')).toBe(false);
    await storage.putBuffer('folder/a', Buffer.from(''));
    await expect(storage.getBuffer('folder')).rejects.toThrow(/EISDIR/);
  });

  it.each(['../secret', 'a/../../secret', '/etc/passwd', '', 'A', 'a b', '.hidden', 'a/..'])(
    'refuses the key %j',
    async (key) => {
      expect(() => storage.localPath(key)).toThrow(/invalid storage key/);
      await expect(storage.putBuffer(key, Buffer.from('x'))).rejects.toThrow(/invalid storage key/);
    },
  );
});
