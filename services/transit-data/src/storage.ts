// Object storage for raw GTFS archives (raw layer) and built timetable artifacts. The `fs`
// driver keeps them under STORAGE_PATH; an S3 driver with the same interface follows with the
// cloud deployment.
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

export interface Storage {
  /** Copies a local file to `key`. */
  putFile(key: string, file: string): Promise<void>;
  putBuffer(key: string, data: Buffer): Promise<void>;
  /** undefined when the key does not exist. */
  getBuffer(key: string): Promise<Buffer | undefined>;
  exists(key: string): Promise<boolean>;
  /** A local path to read the object from (fs driver: the object itself). */
  localPath(key: string): string;
  stream(key: string): Readable;
}

const KEY = /^[a-z0-9][a-z0-9._/-]*$/;

export class FsStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  localPath(key: string): string {
    if (!KEY.test(key) || key.includes('..')) {
      throw new Error(`invalid storage key ${key}`);
    }
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`invalid storage key ${key}`);
    }
    return path;
  }

  async putFile(key: string, file: string): Promise<void> {
    const target = this.localPath(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file, `${target}.part`);
    await rename(`${target}.part`, target); // readers never see a half-written object
  }

  async putBuffer(key: string, data: Buffer): Promise<void> {
    const target = this.localPath(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.part`, data);
    await rename(`${target}.part`, target);
  }

  async getBuffer(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.localPath(key));
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  stream(key: string): Readable {
    return createReadStream(this.localPath(key));
  }
}
