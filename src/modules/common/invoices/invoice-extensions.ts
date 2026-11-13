import type { z } from 'zod';
import type { InvoiceExtensionData } from './invoices.models.js';
import type { CreateInvoiceInput } from './invoices.schemas.js';

/**
 * How an app module (GPP, SJO, ROSPBU) plugs its own fields into the common invoice flow, so the
 * common invoices module never depends on an app module. Registered at startup (modules/index.ts).
 */
export interface InvoiceAppExtension {
  /** Application the extension belongs to (app.applications.code: GP, SJO, ROSPBU). */
  applicationCode: string;
  /** Extra fields on every Invoices grid row, from the app's usp_invoice_list columns (null when absent). */
  listFields?: (data: InvoiceExtensionData) => Record<string, unknown>;
  /** Extra fields on every Invoice Detail, from the app's usp_invoice_get_by_code columns (null when absent). */
  detailFields?: (data: InvoiceExtensionData) => Record<string, unknown>;
  /**
   * Create Invoice / Bulk Upload rules for this app's invoices: the request schema (replaces the
   * common one) and the app's extra udt_invoice_input columns.
   */
  create?: {
    schema: z.ZodType<CreateInvoiceInput>;
    extraColumns: (input: CreateInvoiceInput) => Record<string, unknown>;
  };
  /** Invoice Details "Save": an optional body section (e.g. sjoFields) validated and saved by the app. */
  detailsSection?: {
    key: string;
    schema: z.ZodType;
    save: (invoiceCode: string, userId: string, value: never) => Promise<void>;
  };
}

const extensions = new Map<string, InvoiceAppExtension>();

export const registerInvoiceExtension = (extension: InvoiceAppExtension) => {
  extensions.set(extension.applicationCode.toUpperCase(), extension);
};

export const invoiceExtensions = () => [...extensions.values()];

export const invoiceExtensionFor = (applicationCode: string) => extensions.get(applicationCode.toUpperCase());
