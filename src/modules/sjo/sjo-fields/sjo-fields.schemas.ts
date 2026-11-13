import { z } from 'zod';
import {
  amountSchema,
  blankToNull,
  createInvoiceCommonFields,
  cuitSchema,
  flag,
  optionalText,
  requiredText,
} from '../../common/invoices/invoices.schemas.js';

// ---- Request validation for the SJO invoice fields ----

/**
 * SJO Create Invoice / Bulk Upload: Country, BU, ERP (code or name of a Configuration item) and
 * ID Fiscal are required; vendor / CUIT / amount are optional (the vendor is identified by
 * ID Fiscal / A.B. Number).
 */
export const sjoCreateInvoiceSchema = z.object({
  ...createInvoiceCommonFields,
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

export type SjoCreateInvoiceInput = z.infer<typeof sjoCreateInvoiceSchema>;

/** Invoice Details "Save" section `sjoFields` (omit it to leave the SJO fields unchanged). */
export const sjoFieldsBody = z.object({
  countryId: z.uuid(),
  businessUnitId: z.uuid(),
  erpSystemId: z.uuid(),
  idFiscal: z.string().trim().min(1, 'Required').max(30),
  abNumber: z.string().trim().max(30).nullable().optional().transform((v) => v || null),
  abName: z.string().trim().max(255).nullable().optional().transform((v) => v || null),
  flowTurnDown: z.boolean().default(false),
  criticalVendor: z.boolean().default(false),
  urgentInvoice: z.boolean().default(false),
});
