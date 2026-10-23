import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { verifyAttachmentSignature } from '../../utils/fileUrl.js';
import { parse } from '../../utils/validate.js';
import { findAttachmentById } from '../invoices/invoices.repository.js';

// Mounted at /api/files - authorised by signed URL instead of the Bearer token
const router = Router();

/** GET /api/files/attachments/:id?expires=&sig=[&download=1] */
router.get('/attachments/:id', async (req, res) => {
  const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
  const { expires, sig, download } = parse(
    z.object({ expires: z.coerce.number().int(), sig: z.string().min(1), download: z.string().optional() }),
    req.query,
  );
  if (!verifyAttachmentSignature(id, expires, sig)) throw HttpError.forbidden('Link is invalid or has expired');

  const attachment = await findAttachmentById(id);
  if (!attachment) throw HttpError.notFound('Attachment not found');

  const filePath = path.resolve(env.storageRoot, attachment.storagePath);
  if (!filePath.startsWith(env.storageRoot + path.sep) || !fs.existsSync(filePath)) {
    throw HttpError.notFound('Attachment file is missing');
  }

  res.type(attachment.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (download) res.attachment(attachment.fileName);
  else res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
  res.sendFile(filePath);
});

export default router;
