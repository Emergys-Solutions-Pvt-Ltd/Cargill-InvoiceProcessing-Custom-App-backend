import type { Readable } from 'node:stream';

/**
 * Low-level file storage used by the attachment service. Two implementations: local disk
 * (STORAGE_DIR) and Amazon S3 (or an S3-compatible store). Callers never see SDK types,
 * credentials or retries - they get StorageError with a stable code.
 */
export type StorageProvider = 'local' | 's3';

export interface StoredObject {
  provider: StorageProvider;
  /** S3 bucket; null for local disk. */
  bucket: string | null;
  /** S3 object key or path below the local storage root. */
  key: string;
  size: number;
  etag: string | null;
}

export interface PutOptions {
  contentType: string;
  /** SHA-256 of the body (hex); sent to S3 for an end-to-end integrity check. */
  sha256: string;
  metadata?: Record<string, string>;
}

export interface ObjectContent {
  body: Readable;
  contentType: string | null;
  contentLength: number | null;
  /** Set for ranged reads (HTTP 206). */
  contentRange: string | null;
  etag: string | null;
}

export interface FileStorage {
  readonly provider: StorageProvider;
  readonly bucket: string | null;
  /**
   * Writes the object only when the key is free (never overwrites another file).
   * Returns null when the key already exists, so the caller can pick another name.
   */
  putIfAbsent(key: string, body: Buffer, options: PutOptions): Promise<StoredObject | null>;
  /** Streams an object; `range` is an HTTP Range header value ("bytes=0-1023"). */
  get(key: string, options?: { range?: string }): Promise<ObjectContent>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Connectivity / permission check (S3: HeadBucket). */
  check(): Promise<void>;
}

export type StorageErrorCode =
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'CONFIG'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_RANGE'
  | 'TOO_LARGE'
  | 'FAILED';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export const isStorageError = (err: unknown): err is StorageError => err instanceof StorageError;
