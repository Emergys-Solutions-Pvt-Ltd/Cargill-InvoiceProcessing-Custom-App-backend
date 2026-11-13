import type { StorageProvider } from '../attachments/storage/file-storage.js';

export interface Mailbox {
  id: string;
  address: string;
  folder: string;
  moduleId: string;
  /** Graph delta link of the last finished poll; null = full sync on the next poll. */
  deltaLink: string | null;
  lastPolledAt: Date | null;
  lastError: string | null;
}

export type MailboxEmailStatus = 'New' | 'Processed' | 'Ignored' | 'Failed';

export interface MailboxEmail {
  id: string;
  mailboxId: string;
  graphMessageId: string;
  subject: string;
  fromAddress: string | null;
  receivedAt: Date;
  hasAttachments: boolean;
  status: MailboxEmailStatus;
  invoiceId: string | null;
  /** Stored by this call (false: it was already stored). */
  isNew: boolean;
  /** Has attachments that were never fully processed (new email, or an interrupted run - gap G1). */
  attachmentsPending: boolean;
}

export interface MailboxAttachment {
  id: string;
  mailboxEmailId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  isInline: boolean;
  createdAt: Date;
  storageProvider: StorageProvider;
  storageBucket: string | null;
  contentSha256: string | null;
  storageEtag: string | null;
}

/** A file written to storage, before it is registered in the database. */
export interface StoredFile {
  /** Original name, kept only as metadata. */
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** S3 object key, or path below STORAGE_DIR for local disk. */
  storagePath: string;
  isInline: boolean;
  storageProvider: StorageProvider;
  /** S3 bucket; null for local disk. */
  storageBucket: string | null;
  contentSha256: string;
  storageEtag: string | null;
}

export interface PollStats {
  /** Messages read from Graph. */
  emails: number;
  /** Of which stored for the first time. */
  newEmails: number;
  /** PDFs saved. */
  files: number;
  /** PDFs that could not be saved (email marked Failed). */
  failedFiles: number;
}
