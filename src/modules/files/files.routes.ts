import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { z } from 'zod';
import { attachmentStorage } from '../../storage/index.js';
import { HttpError } from '../../utils/httpError.js';
import { verifyAttachmentSignature } from '../../utils/fileUrl.js';
import { parse } from '../../utils/validate.js';
import { findAttachmentById } from '../invoices/invoices.repository.js';

// Mounted at /api/files - authorised by signed URL instead of the Bearer token
const router = Router();

/**
 * GET /api/files/attachments/:id?expires=&sig=[&download=1]
 * Streams the file from wherever its row says it lives (S3 bucket or local disk) through the
 * attachment storage service; the bucket is never exposed to browsers. Supports HTTP Range
 * (PDF viewers fetch large documents in parts).
 */
router.get('/attachments/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
  const { expires, sig, download } = parse(
    z.object({ expires: z.coerce.number().int(), sig: z.string().min(1), download: z.string().optional() }),
    req.query,
  );
  if (!verifyAttachmentSignature(id, expires, sig)) throw HttpError.forbidden('Link is invalid or has expired');

  const attachment = await findAttachmentById(id);
  if (!attachment) throw HttpError.notFound('Attachment not found');

  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  const file = await attachmentStorage.open(attachment, range);

  res.status(file.contentRange ? 206 : 200);
  res.type(attachment.mimeType || file.contentType || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (file.contentLength !== null) res.setHeader('Content-Length', String(file.contentLength));
  if (file.contentRange) res.setHeader('Content-Range', file.contentRange);
  if (download) res.attachment(attachment.fileName);
  else res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);

  try {
    await pipeline(file.body, res);
  } catch {
    // Client went away or the storage stream broke mid-way: headers are sent, just close
    res.destroy();
  }
});

export default router;
