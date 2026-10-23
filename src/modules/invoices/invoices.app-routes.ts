import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../apps/apps.repository.js';
import { parseDateTime } from '../../utils/format.js';
import { paginationQuery } from '../../utils/pagination.js';
import { parse } from '../../utils/validate.js';
import { insertInvoices, listInvoices, type NewInvoice } from './invoices.repository.js';
import { toInvoiceListItem } from './invoices.mapper.js';

// Mounted at /api/apps/:appId/invoices (requireAppAccess has already resolved res.locals.appModule)
const router = Router();

const MAX_BULK_INVOICES = 500;

// Status codes live in app.statuses; usp_invoice_create_batch validates them case-insensitively
const statusSchema = z.string().trim().min(1).max(20);

const dateString = z.string().transform((value, ctx) => {
  const date = parseDateTime(value);
  if (!date) {
    ctx.addIssue({ code: 'custom', message: 'Invalid date' });
    return z.NEVER;
  }
  return date;
});

const invoiceInput = z.object({
  id: z.string().trim().min(1).max(60).optional(),
  vendorName: z.string().trim().min(1).max(255),
  cuit: z.string().trim().regex(/^\d{2}-?\d{8}-?\d$/, 'CUIT must look like 30-50001234-9'),
  countryStation: z.string().trim().max(160).optional().nullable(),
  invoice1a: z.string().trim().max(30).optional().nullable(),
  invoice2a: z.string().trim().max(30).optional().nullable(),
  amount: z.coerce.number().nonnegative().max(1e15),
  status: statusSchema.default('Pending'),
  receptionDate: dateString.optional(),
  emailReceptionDate: dateString.optional().nullable(),
});

type InvoiceInput = z.infer<typeof invoiceInput>;

const listQuery = z.object({
  search: z.string().trim().default(''),
  status: z
    .string()
    .trim()
    .default('ALL')
    .transform((s) => (s.toUpperCase() === 'ALL' ? 'ALL' : s)),
  ...paginationQuery,
});

const toNewInvoice = (appModule: AppModule, input: InvoiceInput): NewInvoice => {
  const now = new Date();
  return {
    invoiceCode: input.id ?? `INV-${appModule.invoicePrefix}-${crypto.randomInt(100000, 1000000)}`,
    vendorName: input.vendorName,
    cuit: input.cuit,
    countryStation: input.countryStation ?? null,
    invoice1a: input.invoice1a ?? null,
    invoice2a: input.invoice2a ?? null,
    amount: input.amount,
    status: input.status,
    receptionDate: input.receptionDate ?? now,
    emailReceptionDate: input.emailReceptionDate ?? null,
  };
};

/** usp_Invoice_CreateBatch enforces duplicate ids, existing ids and the daily limit atomically. */
const createInvoices = (appModule: AppModule, inputs: InvoiceInput[], userId: number) =>
  insertInvoices(appModule.moduleId, inputs.map((i) => toNewInvoice(appModule, i)), userId);

/** GET /api/apps/:appId/invoices?search=&status=&page=&limit= */
router.get('/', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const filters = parse(listQuery, req.query);
  const { rows, ...meta } = await listInvoices(appModule.moduleId, filters);
  res.json({ data: rows.map(toInvoiceListItem), ...meta });
});

/** POST /api/apps/:appId/invoices/bulk  { invoices: [...] } */
router.post('/bulk', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const { invoices } = parse(
    z.object({ invoices: z.array(invoiceInput).min(1).max(MAX_BULK_INVOICES) }),
    req.body,
  );
  const created = await createInvoices(appModule, invoices, req.user!.id);
  res.status(201).json({
    message: 'Bulk invoices created successfully',
    count: created.length,
    data: created,
  });
});

/** POST /api/apps/:appId/invoices - "Create Invoice" modal */
router.post('/', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const input = parse(invoiceInput, req.body);
  const [created] = await createInvoices(appModule, [input], req.user!.id);
  res.status(201).json({ message: 'Invoice created successfully', data: { id: created } });
});

export default router;
