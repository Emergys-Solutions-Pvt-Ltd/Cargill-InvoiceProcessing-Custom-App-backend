import { z } from 'zod';
import { paginationQuery } from '../../../core/http/pagination.js';
import { parseDateTime } from '../../../core/utils/format.js';

// ---- Request validation for the common invoice endpoints (and helpers app modules reuse) ----

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

export const cuitSchema = z.string().trim().regex(/^\d{2}-?\d{8}-?\d$/, 'CUIT must look like 30-50001234-9');
export const amountSchema = z.coerce.number().nonnegative().max(1e15);

/** Blank → null, so CSV / form values can leave optional fields empty. */
export const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
export const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional()).transform((v) => v ?? null);
export const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** Checkbox / CSV flag: true, false, yes / no, sí, x, 1 / 0; empty = false. */
const TRUE_VALUES = new Set(['true', 'yes', 'y', 'si', 'sí', 'x', '1']);
export const flag = z
  .union([z.boolean(), z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === 'string' ? TRUE_VALUES.has(v.trim().toLowerCase()) : Boolean(v)));

/** Fields every app's Create Invoice / Bulk Upload accepts. */
export const createInvoiceCommonFields = {
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

/** Default Create Invoice / Bulk Upload input (GPP, ROSPBU): vendor, CUIT and amount are required. */
export const createInvoiceSchema = z.object({
  ...createInvoiceCommonFields,
  vendorName: z.string().trim().min(1).max(255),
  cuit: cuitSchema,
  amount: amountSchema,
});

/** What the create flow needs from any app's create schema; app schemas add their own keys. */
export interface CreateInvoiceInput {
  id?: string;
  vendorName: string | null;
  cuit: string | null;
  amount: number | null;
  countryStation?: string | null;
  invoice1a?: string | null;
  invoice2a?: string | null;
  status: string;
  receptionDate?: Date;
  emailReceptionDate?: Date | null;
  assignedUserId: number | null;
}

export const MAX_BULK_INVOICES = 500;

export const invoiceListQuery = z.object({
  search: z.string().trim().default(''),
  status: z
    .string()
    .trim()
    .default('ALL')
    .transform((s) => (s.toUpperCase() === 'ALL' ? 'ALL' : s)),
  ...paginationQuery,
});

export const invoiceCodeParam = z.object({ invoiceId: z.string().trim().min(1).max(60) });

export const invoiceStatusBody = z.object({ status: z.string().trim().min(1).max(20) });

const nullableId = z.coerce.number().int().positive().nullable().optional().transform((v) => v ?? null);

/** Invoice Details "Save" (common Super User fields); app extensions add their own sections. */
export const invoiceDetailsBody = z.object({
  processId: nullableId,
  originCityId: nullableId,
  destinationCityId: nullableId,
  claimNumber: z.coerce.number().min(0).max(1e15).default(0),
  additionalInfo: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
  assignedUserId: nullableId,
});

export const attachmentUploadQuery = z.object({
  fileName: z.string().trim().min(1).max(200).regex(/\.pdf$/i, 'Only PDF files can be uploaded'),
  title: z.string().trim().max(255).optional(),
  primary: z.stringbool().default(true),
});
