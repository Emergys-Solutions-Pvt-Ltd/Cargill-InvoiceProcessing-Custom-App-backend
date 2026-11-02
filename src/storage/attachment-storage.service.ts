import crypto from 'node:crypto';
import { appFolder, attachmentKey, nameSuffix } from './attachment-keys.js';
import { FileStorage, ObjectContent, StorageError, StorageProvider, StoredObject } from './file-storage.js';

/**
 * Attachment storage service - the single place that stores and reads invoice files:
 *   store():  uploads to the configured storage (S3 or local) under
 *             [prefix/]<App>/<YYYY>/<Mon>/<file name>, never overwriting (name-2.pdf ... name-<random>.pdf), then
 *             registers the row in app.invoice_attachments (provider, bucket, key, SHA-256, ETag).
 *             If the database insert fails the uploaded object is deleted again (no orphans).
 *   open():   streams a file from wherever its row says it lives (old local files keep working
 *             after switching to S3), with HTTP ranges.
 *   health(): connectivity / permission check of the write storage.
 */
export interface AttachmentRecordInput {
  invoiceCode: string;
  fileName: string;
  title: string | null;
  category: string;
  mimeType: string;
  isPrimary: boolean;
}

export interface StoreAttachmentInput extends AttachmentRecordInput {
  content: Buffer;
  /** Folder date (defaults to now). */
  date?: Date;
}

export interface RegisteredFile {
  provider: StorageProvider;
  bucket: string | null;
  key: string;
  size: number;
  sha256: string;
  etag: string | null;
}

/** Persistence the service needs (invoices repository in production, fakes in tests). */
export interface AttachmentRegistry<TRow> {
  applicationCodeOf(invoiceCode: string): Promise<string | null>;
  register(input: AttachmentRecordInput, file: RegisteredFile): Promise<TRow>;
}

export interface AttachmentLocation {
  storageProvider: StorageProvider;
  storageBucket: string | null;
  storagePath: string;
}

export interface AttachmentStorageOptions {
  /** Where new files go. */
  storage: FileStorage;
  /** Reader for files stored elsewhere (local files after the switch to S3; other buckets). */
  readerFor: (provider: StorageProvider, bucket: string | null) => FileStorage;
  appFolders: Record<string, string>;
  prefix: string;
  timeZone: string;
  maxBytes: number;
  logger?: { warn: (msg: string, ctx?: Record<string, unknown>) => void; info: (msg: string, ctx?: Record<string, unknown>) => void };
  now?: () => Date;
  /** Max. name variants tried in one month folder (Invoice-123-2.pdf ...). */
  maxNameAttempts?: number;
  /** Random suffix for names still taken after the numbered variants (tests make it deterministic). */
  randomSuffix?: () => string;
}

export class AttachmentStorageService<TRow> {
  constructor(
    private readonly options: AttachmentStorageOptions,
    private readonly registry: AttachmentRegistry<TRow>,
  ) {}

  get provider(): StorageProvider {
    return this.options.storage.provider;
  }

  get bucket(): string | null {
    return this.options.storage.bucket;
  }

  /** Object key for a file of an application (no upload) - used for previews / migration planning. */
  keyFor(applicationCode: string, fileName: string, date: Date, suffix: string | null = null): string {
    return attachmentKey({
      prefix: this.options.prefix,
      appFolder: appFolder(applicationCode, this.options.appFolders),
      date,
      timeZone: this.options.timeZone,
      fileName,
      suffix,
    });
  }

  /** Uploads under a free key of the application's month folder; returns where it went. */
  async upload(applicationCode: string, fileName: string, content: Buffer, mimeType: string, date?: Date): Promise<RegisteredFile> {
    if (content.length === 0) throw new StorageError('FAILED', 'The file is empty');
    if (content.length > this.options.maxBytes) {
      throw new StorageError('TOO_LARGE', `The file is larger than ${Math.round(this.options.maxBytes / 1048576)} MB`);
    }
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const when = date ?? this.options.now?.() ?? new Date();
    const attempts = this.options.maxNameAttempts ?? 10;
    const random = this.options.randomSuffix ?? (() => crypto.randomBytes(4).toString('hex'));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const key = this.keyFor(applicationCode, fileName, when, nameSuffix(attempt, random));
      const stored: StoredObject | null = await this.options.storage.putIfAbsent(key, content, {
        contentType: mimeType,
        sha256,
        metadata: { 'original-name': encodeURIComponent(fileName).slice(0, 1024) },
      });
      if (stored) return { provider: stored.provider, bucket: stored.bucket, key: stored.key, size: stored.size, sha256, etag: stored.etag };
    }
    throw new StorageError('FAILED', `Could not find a free file name for ${fileName} after ${attempts} attempts`);
  }

  /** Uploads the file and registers it as an attachment of the invoice. */
  async store(input: StoreAttachmentInput): Promise<TRow> {
    const applicationCode = await this.registry.applicationCodeOf(input.invoiceCode);
    if (!applicationCode) throw new StorageError('NOT_FOUND', `Invoice ${input.invoiceCode} not found`);
    const file = await this.upload(applicationCode, input.fileName, input.content, input.mimeType, input.date);
    try {
      const row = await this.registry.register(input, file);
      this.options.logger?.info('Attachment stored', {
        invoiceCode: input.invoiceCode, provider: file.provider, bucket: file.bucket, key: file.key, size: file.size,
      });
      return row;
    } catch (err) {
      // Keep storage and database consistent: the object without a row would be invisible
      await this.options.storage.delete(file.key).catch((cleanupErr) =>
        this.options.logger?.warn('Could not remove an unregistered upload', { key: file.key, error: String(cleanupErr) }),
      );
      throw err;
    }
  }

  /** Streams a stored attachment (optionally a byte range). */
  async open(location: AttachmentLocation, range?: string): Promise<ObjectContent> {
    const reader =
      location.storageProvider === this.options.storage.provider && location.storageBucket === this.options.storage.bucket
        ? this.options.storage
        : this.options.readerFor(location.storageProvider, location.storageBucket);
    return reader.get(location.storagePath, range ? { range } : {});
  }

  async health(): Promise<{ provider: StorageProvider; bucket: string | null; status: 'up' | 'down'; error?: string }> {
    try {
      await this.options.storage.check();
      return { provider: this.provider, bucket: this.bucket, status: 'up' };
    } catch (err) {
      return { provider: this.provider, bucket: this.bucket, status: 'down', error: err instanceof Error ? err.message : String(err) };
    }
  }
}
