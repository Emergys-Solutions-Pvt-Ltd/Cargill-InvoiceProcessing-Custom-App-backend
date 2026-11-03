import { callFunction } from '../../../../../core/db/procedures.js';
import { findModuleBySlug } from '../../../apps/apps.dal.js';
import type { AttachmentStorageService } from '../../../attachments/storage/attachment-storage.service.js';
import type { SourceDocument } from '../core/contracts.js';
import type { AttachmentStore } from '../sync/ports.js';

/** Invoices (and their attachments) live in the schema of the module's app (gpp, sjo, rospbu). */
const appSchemaOf = async (moduleSlug: string) => {
  const appModule = await findModuleBySlug(moduleSlug);
  if (!appModule) throw new Error(`Module ${moduleSlug} not found`);
  return appModule.appSchema;
};

/**
 * Source documents of ECM integrations (OnBase PDFs ...) go through the attachment storage
 * service like every other file: S3 (or local) under <App>/<YYYY>/<Mon>/<file name>, registered
 * as the invoice's primary attachment so the Invoice Details PDF viewer shows them.
 */
export class StorageAttachmentStore implements AttachmentStore {
  constructor(private readonly storage: AttachmentStorageService<unknown>) {}

  async withoutAttachment(moduleSlug: string, invoiceCodes: string[]): Promise<Set<string>> {
    if (invoiceCodes.length === 0) return new Set();
    const appSchema = await appSchemaOf(moduleSlug);
    const rows = await callFunction<{ code: string }>(`${appSchema}.usp_integration_invoices_without_attachment`, {
      p_invoice_codes: invoiceCodes,
    });
    return new Set(rows.map((r) => r.code));
  }

  async save(moduleSlug: string, invoiceCode: string, document: SourceDocument, sourceKey: string): Promise<void> {
    await this.storage.store({
      appSchema: await appSchemaOf(moduleSlug),
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
