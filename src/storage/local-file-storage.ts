import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FileStorage, ObjectContent, PutOptions, StorageError, StoredObject } from './file-storage.js';

/**
 * Local disk below STORAGE_DIR (development, single-server deployments, files created before S3).
 * Same contract as S3: no overwrites (exclusive create), ranged reads, path traversal refused.
 */
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff', '.tiff': 'image/tiff' };

/** "bytes=start-end" / "bytes=start-" / "bytes=-suffix" -> inclusive offsets, or null when unsatisfiable. */
export const parseRange = (header: string, size: number): { start: number; end: number } | null => {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
};

export class LocalFileStorage implements FileStorage {
  readonly provider = 'local' as const;
  readonly bucket = null;

  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) throw new StorageError('NOT_FOUND', 'File not found in storage');
    return target;
  }

  async putIfAbsent(key: string, body: Buffer, _options: PutOptions): Promise<StoredObject | null> {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.writeFile(target, body, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
      throw new StorageError('FAILED', `Could not write the file (${(err as NodeJS.ErrnoException).code ?? 'error'})`, false, err);
    }
    return { provider: 'local', bucket: null, key, size: body.length, etag: null };
  }

  async get(key: string, options: { range?: string } = {}): Promise<ObjectContent> {
    const target = this.resolve(key);
    let size: number;
    try {
      size = (await fsp.stat(target)).size;
    } catch {
      throw new StorageError('NOT_FOUND', 'File not found in storage');
    }
    const contentType = MIME[path.extname(target).toLowerCase()] ?? null;
    if (options.range) {
      const range = parseRange(options.range, size);
      if (!range) throw new StorageError('INVALID_RANGE', 'Requested range not satisfiable');
      return {
        body: fs.createReadStream(target, range),
        contentType,
        contentLength: range.end - range.start + 1,
        contentRange: `bytes ${range.start}-${range.end}/${size}`,
        etag: null,
      };
    }
    return { body: fs.createReadStream(target), contentType, contentLength: size, contentRange: null, etag: null };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async check(): Promise<void> {
    try {
      await fsp.mkdir(this.root, { recursive: true });
      await fsp.access(this.root, fs.constants.W_OK);
    } catch (err) {
      throw new StorageError('CONFIG', 'The local storage folder (STORAGE_DIR) is not writable', false, err);
    }
  }
}
