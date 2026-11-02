import path from 'node:path';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { hasAppAccess } from '../../middleware/auth.js';
import { attachmentStorage } from '../../storage/index.js';
import { HttpError } from '../../utils/httpError.js';
import { signedAttachmentUrl } from '../../utils/fileUrl.js';
import { toDisplayDateTime } from '../../utils/format.js';
import { parse } from '../../utils/validate.js';
import {
  getInvoiceDetail,
  listCcpps,
  saveCcpp,
  saveSjoFields,
  sendToPreviousTeam,
  updateInvoiceDetails,
  updateInvoiceStatus,
  type CcppInput,
} from './invoices.repository.js';
import { toAttachment, toCcppDetail, toCcppListItem, toInvoiceDetail } from './invoices.mapper.js';

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
  /** SJO invoices only; omit to leave the SJO fields unchanged. */
  sjoFields: z
    .object({
      countryId: z.coerce.number().int().positive(),
      businessUnitId: z.coerce.number().int().positive(),
      erpSystemId: z.coerce.number().int().positive(),
      idFiscal: z.string().trim().min(1, 'Required').max(30),
      abNumber: z.string().trim().max(30).nullable().optional().transform((v) => v || null),
      abName: z.string().trim().max(255).nullable().optional().transform((v) => v || null),
      flowTurnDown: z.boolean().default(false),
      criticalVendor: z.boolean().default(false),
      urgentInvoice: z.boolean().default(false),
    })
    .optional(),
});

/** PUT /api/invoices/:invoiceId/details - Invoice Details "Save" (Super User fields, SJO fields) */
router.put('/:invoiceId/details', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const { sjoFields, ...details } = parse(detailsBody, req.body);
  // SJO fields first: their validation (required / inactive values) fails before anything is written
  if (sjoFields) await saveSjoFields(invoice.invoiceCode, req.user!.id, sjoFields);
  await updateInvoiceDetails(invoice.invoiceCode, details);
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
 * Body: the raw PDF (Content-Type: application/pdf, max 20 MB). Stored by the attachment storage
 * service (S3 or local) under <App>/<YYYY>/<Mon>/<file name> and registered as an attachment.
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

    const attachment = await attachmentStorage.store({
      invoiceCode: invoice.invoiceCode,
      fileName: path.basename(fileName),
      title: title || null,
      category: 'Uploaded Document',
      mimeType: 'application/pdf',
      isPrimary: primary,
      content: body,
    });
    res.status(201).json({ message: `${attachment.fileName} uploaded`, data: toAttachment(attachment) });
  },
);

/** GET /api/invoices/:invoiceId - Invoice Detail screen (overview, attachments, line items, CCPPs) */
router.get('/:invoiceId', async (req, res) => {
  const { invoice, ...children } = await loadInvoice(req);
  res.json(toInvoiceDetail(invoice, children));
});

const nullableStr = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const nullableNum = z.coerce.number().nullable().optional().transform((v) => v ?? null);

/** Legacy Salesforce "GP CCPP" fields - everything but product/status is optional. */
const ccppBody = z.object({
  product: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(50),
  legalDocIssuer: nullableStr(200),
  value: nullableNum,
  km: nullableNum,
  tons: nullableNum,
  unitRate: nullableNum,
  kmFc: nullableNum,
  tonsFc: nullableNum,
  thirdJurisdiction: nullableStr(255),
  ab: nullableStr(20),
  aux: nullableStr(20),
  bp: nullableStr(50),
  closedQuantity: nullableNum,
  pendingQuantity: nullableNum,
  totalQuantity: nullableNum,
  cc: nullableStr(50),
  cia: nullableStr(20),
  withholdingCode: nullableStr(255),
  withholdingConcept: nullableStr(255),
  matching: nullableStr(20),
  account: nullableStr(20),
  cuit: nullableStr(20),
  lineDescription: nullableStr(10000),
  receiptDetail: nullableStr(255),
  status1: nullableStr(50),
  status2: nullableStr(50),
  receiptDate: nullableStr(50),
  gcia: nullableStr(100),
  name: nullableStr(100),
  iibbDestination: nullableStr(100),
  iibbOrigin: nullableStr(100),
  closedAmount: nullableStr(20),
  lineAmount: nullableNum,
  matchedAmount: nullableStr(20),
  pendingAmount: nullableNum,
  orderTotalAmount: nullableNum,
  vat: nullableStr(100),
  line: nullableNum,
  currency: nullableStr(10),
  municipality: nullableStr(100),
  orderNumber: nullableStr(20),
  receiptNumber: nullableStr(20),
  observation: nullableStr(10000),
  originDestinationDrei: nullableStr(255),
  ownerLegacyId: nullableStr(1000),
  praclo: nullableStr(20),
  praptd: nullableStr(20),
  prdgl: nullableStr(50),
  province: nullableStr(255),
  pruorg: nullableStr(20),
  suss: nullableStr(100),
  taxArea: nullableStr(255),
  orderType: nullableStr(20),
  receiptType: nullableStr(20),
  takeLine: nullableStr(100),
  uniqueCcpp: nullableStr(255),
  userLegacyId: nullableStr(50),
  fiscalZone: nullableStr(100),
});

const ccppIdParam = z.object({ ccppId: z.coerce.number().int().positive() });

/** GET /api/invoices/:invoiceId/ccpp - CCPP tab list (condensed columns) */
router.get('/:invoiceId/ccpp', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const ccpps = await listCcpps(invoice.invoiceCode);
  res.json(ccpps.map(toCcppListItem));
});

/** GET /api/invoices/:invoiceId/ccpp/:ccppId - CCPP tab row-expand detail (all fields) */
router.get('/:invoiceId/ccpp/:ccppId', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const { ccppId } = parse(ccppIdParam, req.params);
  const ccpps = await listCcpps(invoice.invoiceCode);
  const ccpp = ccpps.find((c) => c.id === ccppId);
  if (!ccpp) throw HttpError.notFound(`CCPP row '${ccppId}' not found on this invoice`);
  res.json(toCcppDetail(ccpp));
});

/** POST /api/invoices/:invoiceId/ccpp - CCPP tab "Add" */
router.post('/:invoiceId/ccpp', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const input = parse(ccppBody, req.body) as CcppInput;
  const ccpp = await saveCcpp(invoice.invoiceCode, req.user!.id, input);
  res.status(201).json({ message: 'CCPP entry added', data: toCcppDetail(ccpp) });
});

/** PUT /api/invoices/:invoiceId/ccpp/:ccppId - CCPP tab "Edit" */
router.put('/:invoiceId/ccpp/:ccppId', async (req, res) => {
  const { invoice } = await loadInvoice(req);
  const { ccppId } = parse(ccppIdParam, req.params);
  const input = parse(ccppBody, req.body) as CcppInput;
  const ccpp = await saveCcpp(invoice.invoiceCode, req.user!.id, input, ccppId);
  res.json({ message: 'CCPP entry updated', data: toCcppDetail(ccpp) });
});

export default router;
