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

const cuitSchema = z.string().trim().regex(/^\d{2}-?\d{8}-?\d$/, 'CUIT must look like 30-50001234-9');
const amountSchema = z.coerce.number().nonnegative().max(1e15);

/** Blank → null, so CSV / form values can leave optional fields empty. */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional()).transform((v) => v ?? null);
const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** Checkbox / CSV flag: true, false, yes / no, sí, x, 1 / 0; empty = false. */
const TRUE_VALUES = new Set(['true', 'yes', 'y', 'si', 'sí', 'x', '1']);
const flag = z
  .union([z.boolean(), z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === 'string' ? TRUE_VALUES.has(v.trim().toLowerCase()) : Boolean(v)));

const commonFields = {
  id: z.string().trim().min(1).max(60).optional(),
  countryStation: z.string().trim().max(160).optional().nullable(),
  invoice1a: z.string().trim().max(30).optional().nullable(),
  invoice2a: z.string().trim().max(30).optional().nullable(),
  status: statusSchema.default('Pending'),
  receptionDate: dateString.optional(),
  emailReceptionDate: dateString.optional().nullable(),
  /** "Assign To" */
  assignedUserId: z.preprocess(blankToNull, z.coerce.number().int().positive().nullable().optional()).transform((v) => v ?? null),
};

const invoiceInput = z.object({
  ...commonFields,
  vendorName: z.string().trim().min(1).max(255),
  cuit: cuitSchema,
  amount: amountSchema,
});

/**
 * SJO Invoice Processing: Country, BU, ERP (code or name of a Configuration item) and ID Fiscal are
 * required; vendor / CUIT / amount are optional (the vendor is identified by ID Fiscal / A.B. Number).
 */
const sjoInvoiceInput = z.object({
  ...commonFields,
  vendorName: optionalText(255),
  cuit: z.preprocess(blankToNull, cuitSchema.nullable().optional()).transform((v) => v ?? null),
  amount: z.preprocess(blankToNull, amountSchema.nullable().optional()).transform((v) => v ?? null),
  country: requiredText(150),
  businessUnit: requiredText(150),
  erp: requiredText(150),
  idFiscal: requiredText(30),
  abNumber: optionalText(30),
  abName: optionalText(255),
  flowTurnDown: flag,
  criticalVendor: flag,
  urgentInvoice: flag,
});

type InvoiceInput = z.infer<typeof invoiceInput> | z.infer<typeof sjoInvoiceInput>;

const isSjo = (appModule: AppModule) => appModule.applicationCode.toUpperCase() === 'SJO';
const inputSchemaFor = (appModule: AppModule) => (isSjo(appModule) ? sjoInvoiceInput : invoiceInput);

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
    assignedUserId: input.assignedUserId,
    sjo:
      'idFiscal' in input
        ? {
            country: input.country,
            businessUnit: input.businessUnit,
            erp: input.erp,
            idFiscal: input.idFiscal,
            abNumber: input.abNumber,
            abName: input.abName,
            flowTurnDown: input.flowTurnDown,
            criticalVendor: input.criticalVendor,
            urgentInvoice: input.urgentInvoice,
          }
        : null,
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
    z.object({ invoices: z.array(inputSchemaFor(appModule)).min(1).max(MAX_BULK_INVOICES) }),
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
  const input = parse(inputSchemaFor(appModule), req.body);
  const [created] = await createInvoices(appModule, [input], req.user!.id);
  res.status(201).json({ message: 'Invoice created successfully', data: { id: created } });
});

export default router;
