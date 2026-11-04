import crypto from 'node:crypto';
import path from 'node:path';
import { env } from '../../../core/config/env.js';
import { writeStorage } from '../attachments/storage/index.js';
import { yearMonth } from '../attachments/storage/attachment-keys.js';
import { StorageError, type FileStorage } from '../attachments/storage/file-storage.js';
import type { GraphAttachment } from './graph/graph-mail.client.js';
import type { StoredFile } from './mailbox.models.js';

/**
 * PDF attachments of mailbox emails, written through the attachment storage (STORAGE_PROVIDER: local or S3):
 *   [S3_PREFIX/]Inbox/<YYYY>/<Mon>/<email id>/<random uuid>.pdf
 * Kept apart from the invoice folders (<App>/<YYYY>/<Mon>/...) until an invoice is created from the email.
 * Random names: the sender chooses the original name, so it is never used as a key (kept as metadata).
 */
const MAX_ATTACHMENT_BYTES = env.STORAGE_MAX_FILE_MB * 1024 * 1024;
const INBOX_FOLDER = 'Inbox';

const segment = (value: string) => value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '');

/** Why the attachment is skipped, or null when it should be stored. */
export function skipReason(att: GraphAttachment, maxBytes = MAX_ATTACHMENT_BYTES): string | null {
  if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') return 'not a file attachment';
  if (att.isInline) return 'inline image';
  if (!/\.pdf$/i.test(att.name)) return 'not a PDF';
  if (!att.contentBytes) return 'no content';
  if (att.size > maxBytes) return `larger than ${Math.round(maxBytes / 1048576)} MB`;
  return null;
}

export interface MailboxFilesOptions {
  storage: FileStorage;
  /** S3_PREFIX; empty for none. */
  prefix: string;
  /** STORAGE_FOLDER_TIMEZONE: year / month folder of the received date. */
  timeZone: string;
  maxBytes: number;
}

export const createMailboxFiles = ({ storage, prefix, timeZone, maxBytes }: MailboxFilesOptions) => {
  const root = prefix.split('/').map(segment).filter(Boolean);

  /** Writes one attachment; throws when the content is not a real PDF or too large. */
  const saveAttachment = async (folderKey: string, att: GraphAttachment, receivedAt: Date): Promise<StoredFile> => {
    const bytes = Buffer.from(att.contentBytes!, 'base64');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${att.name} is not a real PDF`);
    if (bytes.length > maxBytes) throw new StorageError('TOO_LARGE', `${att.name} is larger than ${Math.round(maxBytes / 1048576)} MB`);

    const { year, month } = yearMonth(receivedAt, timeZone);
    const key = [...root, INBOX_FOLDER, year, month, segment(folderKey) || 'email', `${crypto.randomUUID()}.pdf`].join('/');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const fileName = path.basename(att.name.replace(/\\/g, '/')).slice(0, 200);

    const stored = await storage.putIfAbsent(key, bytes, {
      contentType: 'application/pdf',
      sha256,
      metadata: { 'original-name': encodeURIComponent(fileName).slice(0, 1024) },
    });
    if (!stored) throw new StorageError('FAILED', `Storage key already taken: ${key}`); // random uuid: not expected

    return {
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: stored.size,
      storagePath: stored.key,
      isInline: att.isInline,
      storageProvider: stored.provider,
      storageBucket: stored.bucket,
      contentSha256: sha256,
      storageEtag: stored.etag,
    };
  };

  /** Deletes a file written by saveAttachment (no database row points to it). */
  const removeAttachment = (storagePath: string): Promise<void> => storage.delete(storagePath);

  return { saveAttachment, removeAttachment };
};

const mailboxFiles = createMailboxFiles({
  storage: writeStorage,
  prefix: env.S3_PREFIX,
  timeZone: env.STORAGE_FOLDER_TIMEZONE,
  maxBytes: MAX_ATTACHMENT_BYTES,
});

export const { saveAttachment, removeAttachment } = mailboxFiles;
