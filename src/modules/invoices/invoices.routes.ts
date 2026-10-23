import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { hasAppAccess } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { signedAttachmentUrl } from '../../utils/fileUrl.js';
import { toDisplayDateTime } from '../../utils/format.js';
import { parse } from '../../utils/validate.js';
import {
  addAttachment,
  getInvoiceDetail,
  sendToPreviousTeam,
  updateInvoiceDetails,
  updateInvoiceStatus,
} from './invoices.repository.js';
import { toAttachment, toInvoiceDetail } from './invoices.mapper.js';

// Mounted at /api/invoices
const router = Router();

const codeParam = z.object({ invoiceId: z.string().trim().min(1).max(60) });

/** Loads the invoice (usp_Invoice_GetByCode) and checks the caller may access its application. */
const loadInvoice = async (req: Request) => {
  const { invoiceId } = parse(codeParam, req.params);
  const detail = await getInvoiceDetail(invoiceId);
  if (!detail) throw HttpError.notFound(`Invoice '${invoiceId}' not found`);
  if (!hasAppAccess(req.user, detail.invoice.applicationCode)) throw HttpError.forbidden('No access to this invoice');
  return detail;
};

/** GET /api/invoices/:invoiceId/pdf-attachment - primary PDF metadata */
router.get('/:invoiceId/pdf-attachment', async (req, res) => {
  const { invoice, attachments } = await loadInvoice(req);
  const pdf = attachments.find((a) => a.id === invoice.pdfAttachmentId);
  if (!pdf) throw HttpError.notFound('Invoice has no PDF attachment');
  res.json({
    invoiceId: invoice.invoiceCode,
    appId: invoice.moduleSlug,
    pdfFileName: pdf.fileName,
    pdfUrl: signedAttachmentUrl(pdf.id),
    pdfTitle: pdf.title,
    mimetype: pdf.mimeType,
    uploadedAt: toDisplayDateTime(pdf.uploadedAt),
  });
});

/** GET /api/invoices/:invoiceId/attachments */
router.get('/:invoiceId/attachments', async (req, res) => {
  const { attachments } = await loadInvoice(req);
  res.json(attachments.map(toAttachment));
});

/** PATCH /api/invoices/:invoiceId/status  { status } */
router.patch('/:invoiceId/status', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const { status } = parse(z.object({ status: z.string().trim().min(1).max(20) }), req.body);
  await updateInvoiceStatus(invoice.invoiceCode, status);
  // The function matches codes case-insensitively; report the stored code
  const updated = await getInvoiceDetail(invoice.invoiceCode);
  res.json({ message: 'Invoice status updated', data: { id: invoice.invoiceCode, status: updated?.invoice.status ?? status } });
});

const nullableId = z.coerce.number().int().positive().nullable().optional().transform((v) => v ?? null);

const detailsBody = z.object({
  processId: nullableId,
  originCityId: nullableId,
  destinationCityId: nullableId,
  claimNumber: z.coerce.number().min(0).max(1e15).default(0),
  additionalInfo: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  assignedUserId: nullableId,
});

/** PUT /api/invoices/:invoiceId/details - Invoice Details "Save" (Super User fields) */
router.put('/:invoiceId/details', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  await updateInvoiceDetails(invoice.invoiceCode, parse(detailsBody, req.body));
  const { invoice: updated, ...children } = (await getInvoiceDetail(invoice.invoiceCode))!;
  res.json({ message: 'Invoice details saved', data: toInvoiceDetail(updated, children) });
});

/** POST /api/invoices/:invoiceId/send-to-previous-team - move back one team (queue) */
router.post('/:invoiceId/send-to-previous-team', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const team = await sendToPreviousTeam(invoice.invoiceCode);
  res.json({ message: `Invoice sent back to ${team.name}`, data: { id: invoice.invoiceCode, stage: team } });
});

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const uploadQuery = z.object({
  fileName: z.string().trim().min(1).max(200).regex(/\.pdf$/i, 'Only PDF files can be uploaded'),
  title: z.string().trim().max(255).optional(),
  primary: z.stringbool().default(true),
});

/**
 * POST /api/invoices/:invoiceId/attachments?fileName=scan.pdf[&title=&primary=true]
 * Body: the raw PDF (Content-Type: application/pdf, max 20 MB). Stored under STORAGE_DIR/uploads.
 */
router.post(
  '/:invoiceId/attachments',
  express.raw({ type: 'application/pdf', limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const { invoice } = await loadInvoice(req);
    const { fileName, title, primary } = parse(uploadQuery, req.query);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw HttpError.badRequest('Send the PDF as the request body with Content-Type: application/pdf');
    }
    if (body.subarray(0, 5).toString('latin1') !== '%PDF-') throw HttpError.badRequest('The file is not a PDF');

    // Random file name on disk; the original name is only kept as metadata
    const storagePath = `uploads/${crypto.randomUUID()}.pdf`;
    const target = path.join(env.storageRoot, storagePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);

    try {
      const attachment = await addAttachment(invoice.invoiceCode, {
        fileName: path.basename(fileName),
        title: title || null,
        category: 'Uploaded Document',
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        storagePath,
        isPrimary: primary,
      });
      res.status(201).json({ message: `${attachment.fileName} uploaded`, data: toAttachment(attachment) });
    } catch (err) {
      await fs.rm(target, { force: true });
      throw err;
    }
  },
);

/** GET /api/invoices/:invoiceId - Invoice Detail screen (overview, attachments, line items, CCPPs) */
router.get('/:invoiceId', async (req, res) => {
  const { invoice, ...children } = await loadInvoice(req);
  res.json(toInvoiceDetail(invoice, children));
});

export default router;
