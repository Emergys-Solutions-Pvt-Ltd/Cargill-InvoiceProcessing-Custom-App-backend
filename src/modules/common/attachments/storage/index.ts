import { env } from '../../../../core/config/env.js';
import { createLogger } from '../../integrations/engine/core/logger.js';
import { addAttachment, findInvoiceApplicationCode } from '../attachments.dal.js';
import type { AttachmentRow } from '../attachments.models.js';
import type { AppSchema } from '../../apps/apps.models.js';
import { AttachmentStorageService } from './attachment-storage.service.js';
import type { FileStorage, StorageProvider } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';
import { S3FileStorage, type S3StorageConfig } from './s3-file-storage.js';

/**
 * Composition of the attachment storage from the environment (STORAGE_PROVIDER, S3_*).
 * Everything that writes or reads invoice files goes through `attachmentStorage`.
 */
const logger = createLogger({ component: 'storage' });

const s3Config = (bucket: string): S3StorageConfig => ({
  bucket,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT || undefined,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: env.S3_ACCESS_KEY_ID
    ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, sessionToken: env.S3_SESSION_TOKEN || undefined }
    : undefined,
  sse: env.S3_SSE,
  kmsKeyId: env.S3_KMS_KEY_ID || undefined,
  maxAttempts: env.S3_MAX_ATTEMPTS,
  retryBaseDelayMs: env.S3_RETRY_BASE_DELAY_MS,
  connectTimeoutMs: env.S3_CONNECT_TIMEOUT_MS,
  requestTimeoutMs: env.S3_REQUEST_TIMEOUT_MS,
  // Custom endpoints (S3-compatible stores) may not support SHA-256 checksums
  sendChecksum: !env.S3_ENDPOINT,
});

const onRetry = (info: { operation: string; attempt: number; delayMs: number; reason: string }) =>
  logger.warn('S3 call failed, retrying', info);

const local = new LocalFileStorage(env.storageRoot);
const buckets = new Map<string, S3FileStorage>();
const s3For = (bucket: string) => {
  let storage = buckets.get(bucket);
  if (!storage) {
    storage = new S3FileStorage(s3Config(bucket), undefined, { onRetry });
    buckets.set(bucket, storage);
  }
  return storage;
};

const readerFor = (provider: StorageProvider, bucket: string | null): FileStorage => {
  if (provider === 'local') return local;
  if (!bucket) throw new Error('S3 attachment without bucket');
  return s3For(bucket);
};

export const writeStorage: FileStorage = env.STORAGE_PROVIDER === 's3' ? s3For(env.S3_BUCKET) : local;

export const attachmentStorage = new AttachmentStorageService<AttachmentRow>(
  {
    storage: writeStorage,
    readerFor,
    appFolders: env.storageAppFolders,
    prefix: env.S3_PREFIX,
    timeZone: env.STORAGE_FOLDER_TIMEZONE,
    maxBytes: env.STORAGE_MAX_FILE_MB * 1024 * 1024,
    logger,
  },
  {
    applicationCodeOf: (appSchema, invoiceCode) => findInvoiceApplicationCode(appSchema as AppSchema, invoiceCode),
    register: (input, file) =>
      addAttachment(input.appSchema as AppSchema, input.invoiceCode, {
        fileName: input.fileName,
        title: input.title,
        category: input.category,
        mimeType: input.mimeType,
        sizeBytes: file.size,
        storagePath: file.key,
        isPrimary: input.isPrimary,
        storageProvider: file.provider,
        storageBucket: file.bucket,
        contentSha256: file.sha256,
        storageEtag: file.etag,
      }),
  },
);

export { readerFor as storageReaderFor };
