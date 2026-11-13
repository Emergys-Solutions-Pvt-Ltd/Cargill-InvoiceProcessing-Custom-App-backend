import type { AppSchema } from '../apps/apps.models.js';

// Invoice attachments (<app>.invoice_attachments, one table per app) - files stored by the attachment storage service

export interface AttachmentRow {
  id: string;
  fileName: string;
  title: string | null;
  category: string;
  mimeType: string;
  sizeBytes: number | null;
  storagePath: string;
  isPrimary: boolean;
  uploadedAt: Date;
  invoiceId: string;
  applicationCode: string;
  /** App schema of the attachment (ids are unique per app). */
  appSchema: AppSchema;
  /** Where the file lives: 'local' (below STORAGE_DIR) or 's3' (storageBucket / key storagePath). */
  storageProvider: 'local' | 's3';
  storageBucket: string | null;
  contentSha256: string | null;
}

export interface NewAttachment {
  fileName: string;
  title: string | null;
  category: string | null;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  isPrimary: boolean;
  storageProvider?: 'local' | 's3';
  storageBucket?: string | null;
  contentSha256?: string | null;
  storageEtag?: string | null;
}
