import { callFunction, callFunctionSingle, toDate, type DbDate } from '../../../core/db/procedures.js';
import type { AppSchema } from '../apps/apps.models.js';
import type { AttachmentRow, NewAttachment } from './attachments.models.js';

// ---- Data access: <app>.usp_attachment_* of each app schema (result type app.udt_attachment_result) ----

export interface AttachmentResult {
  id: number;
  invoice_id: number;
  file_name: string;
  title: string | null;
  category: string;
  mime_type: string;
  size_bytes: number | null;
  storage_path: string;
  is_primary: boolean;
  uploaded_at: DbDate;
  application_code: string;
  storage_provider: 'local' | 's3' | null;
  storage_bucket: string | null;
  content_sha256: string | null;
}

export const mapAttachmentResult = (appSchema: AppSchema, r: AttachmentResult): AttachmentRow => ({
  id: r.id,
  appSchema,
  invoiceId: r.invoice_id,
  fileName: r.file_name,
  title: r.title,
  category: r.category,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  storagePath: r.storage_path,
  isPrimary: r.is_primary,
  uploadedAt: toDate(r.uploaded_at)!,
  applicationCode: r.application_code,
  storageProvider: r.storage_provider ?? 'local',
  storageBucket: r.storage_bucket ?? null,
  contentSha256: r.content_sha256 ? r.content_sha256.trim() : null,
});

export const findAttachmentById = async (appSchema: AppSchema, id: number): Promise<AttachmentRow | null> => {
  const [row] = await callFunction<AttachmentResult>(`${appSchema}.usp_attachment_get_by_id`, { p_attachment_id: id });
  return row ? mapAttachmentResult(appSchema, row) : null;
};

/** Registers an already stored file. Raises CA404 when the invoice does not exist. */
export const addAttachment = async (appSchema: AppSchema, code: string, file: NewAttachment): Promise<AttachmentRow> =>
  mapAttachmentResult(
    appSchema,
    await callFunctionSingle<AttachmentResult>(`${appSchema}.usp_attachment_add`, {
      p_invoice_code: code,
      p_file_name: file.fileName,
      p_title: file.title,
      p_category: file.category,
      p_mime_type: file.mimeType,
      p_size_bytes: file.sizeBytes,
      p_storage_path: file.storagePath,
      p_is_primary: file.isPrimary,
      p_storage_provider: file.storageProvider ?? 'local',
      p_storage_bucket: file.storageBucket ?? null,
      p_content_sha256: file.contentSha256 ?? null,
      p_storage_etag: file.storageEtag ?? null,
    }),
  );

/** Application code (GP, sjo, rospbu) of an invoice - decides the storage folder. Null = not found. */
export const findInvoiceApplicationCode = async (appSchema: AppSchema, code: string): Promise<string | null> => {
  const [row] = await callFunction<{ code: string }>(`${appSchema}.usp_attachment_storage_context`, { p_invoice_code: code });
  return row?.code ?? null;
};

/** Attachments stored with one provider, by id (keyset paging) - used by the S3 migration. */
export const listAttachmentsByProvider = async (
  appSchema: AppSchema,
  provider: 'local' | 's3',
  afterId: number,
  limit: number,
): Promise<AttachmentRow[]> =>
  (await callFunction<AttachmentResult>(`${appSchema}.usp_attachment_list_by_provider`, { p_storage_provider: provider, p_after_id: afterId, p_limit: limit }))
    .map((r) => mapAttachmentResult(appSchema, r));

/** Repoints an attachment at its new location; false when it had already moved. */
export const moveAttachmentStorage = async (
  appSchema: AppSchema,
  id: number,
  expectedProvider: 'local' | 's3',
  target: { provider: 'local' | 's3'; bucket: string | null; path: string; sha256: string | null; etag: string | null },
): Promise<boolean> => {
  const row = await callFunctionSingle<{ rows_affected: number }>(`${appSchema}.usp_attachment_set_storage`, {
    p_attachment_id: id,
    p_expected_provider: expectedProvider,
    p_storage_provider: target.provider,
    p_storage_bucket: target.bucket,
    p_storage_path: target.path,
    p_content_sha256: target.sha256,
    p_storage_etag: target.etag,
  });
  return row.rows_affected > 0;
};
