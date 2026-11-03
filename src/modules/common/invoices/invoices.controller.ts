import express, { Router, type Request, type Response } from 'express';
import { parse } from '../../../core/http/validate.js';
import { HttpError } from '../../../core/http/http-error.js';
import { signedAttachmentUrl } from '../../../core/utils/file-url.js';
import { toDisplayDateTime } from '../../../core/utils/format.js';
import type { AppModule } from '../apps/apps.models.js';
import { toAttachment } from '../attachments/attachments.mapper.js';
import { toInvoiceDetail } from './invoices.mapper.js';
import { attachmentUploadQuery, invoiceCodeParam, invoiceStatusBody } from './invoices.schemas.js';
import {
  changeInvoiceStatus,
  getAppInvoice,
  invoiceDetailsSchema,
  saveInvoiceDetails,
  sendInvoiceToPreviousTeam,
  uploadInvoicePdf,
} from './invoices.service.js';

// REST controller - one invoice of an app, mounted at /api/apps/:appId/invoices (routes /:invoiceId...;
// requireAppAccess has resolved res.locals.appModule). App modules add their own sub-routes (GPP /:invoiceId/ccpp).
const router = Router();

/** The route's app module and the invoice (in that app's tables). */
export const loadInvoice = async (req: Request, res: Response) => {
  const appModule = res.locals.appModule as AppModule;
  const detail = await getAppInvoice(appModule, parse(invoiceCodeParam, req.params).invoiceId);
  return { appModule, ...detail };
};

/** GET /api/apps/:appId/invoices/:invoiceId/pdf-attachment - primary PDF metadata */
router.get('/:invoiceId/pdf-attachment', async (req, res) => {
  const { invoice, attachments } = await loadInvoice(req, res);
  const pdf = attachments.find((a) => a.id === invoice.pdfAttachmentId);
  if (!pdf) throw HttpError.notFound('Invoice has no PDF attachment');
  res.json({
    invoiceId: invoice.invoiceCode,
    appId: invoice.moduleSlug,
    pdfFileName: pdf.fileName,
    pdfUrl: signedAttachmentUrl(pdf.appSchema, pdf.id),
    pdfTitle: pdf.title,
    mimetype: pdf.mimeType,
    uploadedAt: toDisplayDateTime(pdf.uploadedAt),
  });
});

/** GET /api/apps/:appId/invoices/:invoiceId/attachments */
router.get('/:invoiceId/attachments', async (req, res) => {
  const { attachments } = await loadInvoice(req, res);
  res.json(attachments.map(toAttachment));
});

/** PATCH /api/apps/:appId/invoices/:invoiceId/status  { status } */
router.patch('/:invoiceId/status', async (req, res) => {
  const { appModule, invoice } = await loadInvoice(req, res);
  const { status } = parse(invoiceStatusBody, req.body);
  const stored = await changeInvoiceStatus(appModule.appSchema, invoice.invoiceCode, status);
  res.json({ message: 'Invoice status updated', data: { id: invoice.invoiceCode, status: stored } });
});

/** PUT /api/apps/:appId/invoices/:invoiceId/details - Invoice Details "Save" (Super User fields + the app's section, e.g. sjoFields) */
router.put('/:invoiceId/details', async (req, res) => {
  const { appModule, invoice } = await loadInvoice(req, res);
  const body = parse(invoiceDetailsSchema(), req.body);
  const updated = await saveInvoiceDetails(appModule, invoice.invoiceCode, req.user!.id, body);
  res.json({ message: 'Invoice details saved', data: toInvoiceDetail(updated) });
});

/** POST /api/apps/:appId/invoices/:invoiceId/send-to-previous-team - move back one team (queue) */
router.post('/:invoiceId/send-to-previous-team', async (req, res) => {
  const { appModule, invoice } = await loadInvoice(req, res);
  const team = await sendInvoiceToPreviousTeam(appModule.appSchema, invoice.invoiceCode);
  res.json({ message: `Invoice sent back to ${team.name}`, data: { id: invoice.invoiceCode, stage: team } });
});

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/apps/:appId/invoices/:invoiceId/attachments?fileName=scan.pdf[&title=&primary=true]
 * Body: the raw PDF (Content-Type: application/pdf, max 20 MB). Stored by the attachment storage
 * service (S3 or local) under <App>/<YYYY>/<Mon>/<file name> and registered as an attachment.
 */
router.post(
  '/:invoiceId/attachments',
  express.raw({ type: 'application/pdf', limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const { appModule, invoice } = await loadInvoice(req, res);
    const query = parse(attachmentUploadQuery, req.query);
    const attachment = await uploadInvoicePdf(appModule.appSchema, invoice.invoiceCode, { ...query, content: req.body });
    res.status(201).json({ message: `${attachment.fileName} uploaded`, data: toAttachment(attachment) });
  },
);

/** GET /api/apps/:appId/invoices/:invoiceId - Invoice Detail screen (overview, attachments, line items, app fields) */
router.get('/:invoiceId', async (req, res) => {
  const { appModule: _appModule, ...detail } = await loadInvoice(req, res);
  res.json(toInvoiceDetail(detail));
});

export default router;
