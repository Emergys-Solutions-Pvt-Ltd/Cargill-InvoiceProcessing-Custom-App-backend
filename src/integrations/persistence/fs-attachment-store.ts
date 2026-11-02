import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { callFunction, callFunctionSingle } from '../../db/procedures.js';
import type { SourceDocument } from '../core/contracts.js';
import type { AttachmentStore } from '../sync/ports.js';

/**
 * Stores source documents (OnBase PDFs ...) next to the uploaded attachments, under
 * <STORAGE_DIR>/integrations/<random>.<ext>, and registers them as the invoice's primary
 * attachment (app.usp_attachment_add) - the Invoice Details PDF viewer then shows them.
 */
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/tiff': 'tif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export class FsAttachmentStore implements AttachmentStore {
  constructor(private readonly storageRoot: string) {}

  async withoutAttachment(invoiceCodes: string[]): Promise<Set<string>> {
    if (invoiceCodes.length === 0) return new Set();
    const rows = await callFunction<{ code: string }>('usp_integration_invoices_without_attachment', { p_invoice_codes: invoiceCodes });
    return new Set(rows.map((r) => r.code));
  }

  async save(invoiceCode: string, document: SourceDocument, sourceKey: string): Promise<void> {
    const ext = EXTENSIONS[document.mimeType] ?? 'bin';
    const storagePath = `integrations/${crypto.randomUUID()}.${ext}`;
    const target = path.join(this.storageRoot, storagePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, document.content);
    try {
      await callFunctionSingle('usp_attachment_add', {
        p_invoice_code: invoiceCode,
        p_file_name: path.basename(document.fileName).slice(0, 255),
        p_title: (document.title ?? `Source document ${sourceKey}`).slice(0, 255),
        p_category: 'Source Document',
        p_mime_type: document.mimeType.slice(0, 100),
        p_size_bytes: document.content.length,
        p_storage_path: storagePath,
        p_is_primary: true,
      });
    } catch (err) {
      await fs.rm(target, { force: true });
      throw err;
    }
  }
}
