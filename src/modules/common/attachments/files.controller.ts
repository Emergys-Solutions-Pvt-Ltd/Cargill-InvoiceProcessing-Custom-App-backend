import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../../core/http/validate.js';
import { openSignedAttachment } from './attachments.service.js';

// REST controller - mounted at /api/files - authorised by signed URL instead of the Bearer token
const router = Router();

/**
 * GET /api/files/attachments/:app/:id?expires=&sig=[&download=1]  (:app = gpp | sjo | rospbu)
 * Streams the file from wherever its row says it lives (S3 bucket or local disk) through the
 * attachment storage service; the bucket is never exposed to browsers. Supports HTTP Range
 * (PDF viewers fetch large documents in parts).
 */
router.get('/attachments/:app/:id', async (req, res) => {
  const { app, id } = parse(z.object({ app: z.string().max(20), id: z.uuid() }), req.params);
  const { expires, sig, download } = parse(
    z.object({ expires: z.coerce.number().int(), sig: z.string().min(1), download: z.string().optional() }),
    req.query,
  );
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  const { attachment, file } = await openSignedAttachment(app, id, expires, sig, range);

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
