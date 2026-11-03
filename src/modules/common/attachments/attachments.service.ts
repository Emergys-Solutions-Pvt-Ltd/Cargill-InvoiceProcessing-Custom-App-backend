import { HttpError } from '../../../core/http/http-error.js';
import { verifyAttachmentSignature } from '../../../core/utils/file-url.js';
import { APP_SCHEMAS, type AppSchema } from '../apps/apps.models.js';
import { findAttachmentById } from './attachments.dal.js';
import { attachmentStorage } from './storage/index.js';

// ---- Business rules of attachment downloads (signed, short-lived URLs instead of the Bearer token) ----

/**
 * Checks the signed link and opens the file from wherever its row says it lives (S3 bucket or local
 * disk) through the attachment storage service, honouring an HTTP Range.
 */
export const openSignedAttachment = async (appSchema: string, id: number, expires: number, sig: string, range?: string) => {
  if (!APP_SCHEMAS.includes(appSchema as AppSchema) || !verifyAttachmentSignature(appSchema, id, expires, sig)) {
    throw HttpError.forbidden('Link is invalid or has expired');
  }
  const attachment = await findAttachmentById(appSchema as AppSchema, id);
  if (!attachment) throw HttpError.notFound('Attachment not found');
  return { attachment, file: await attachmentStorage.open(attachment, range) };
};
