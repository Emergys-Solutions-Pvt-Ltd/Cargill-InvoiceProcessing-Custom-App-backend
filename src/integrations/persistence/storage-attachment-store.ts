import { callFunction } from '../../db/procedures.js';
import type { AttachmentStorageService } from '../../storage/attachment-storage.service.js';
import type { SourceDocument } from '../core/contracts.js';
import type { AttachmentStore } from '../sync/ports.js';

/**
 * Source documents of ECM integrations (OnBase PDFs ...) go through the attachment storage
 * service like every other file: S3 (or local) under <App>/<YYYY>/<Mon>/<file name>, registered
 * as the invoice's primary attachment so the Invoice Details PDF viewer shows them.
 */
export class StorageAttachmentStore implements AttachmentStore {
  constructor(private readonly storage: AttachmentStorageService<unknown>) {}

  async withoutAttachment(invoiceCodes: string[]): Promise<Set<string>> {
    if (invoiceCodes.length === 0) return new Set();
    const rows = await callFunction<{ code: string }>('usp_integration_invoices_without_attachment', { p_invoice_codes: invoiceCodes });
    return new Set(rows.map((r) => r.code));
  }

  async save(invoiceCode: string, document: SourceDocument, sourceKey: string): Promise<void> {
    await this.storage.store({
      invoiceCode,
      fileName: document.fileName,
      title: (document.title ?? `Source document ${sourceKey}`).slice(0, 255),
      category: 'Source Document',
      mimeType: document.mimeType.slice(0, 100),
      isPrimary: true,
      content: document.content,
    });
  }
}
