import { saveSjoFields } from './sjo-fields.dal.js';
import type { SjoFieldsInput } from './sjo-fields.models.js';
import type { SjoCreateInvoiceInput } from './sjo-fields.schemas.js';

// ---- Business rules of the SJO invoice fields ----

/**
 * The SJO columns of app.udt_invoice_input for Create Invoice / Bulk Upload; usp_invoice_create_batch
 * resolves country / BU / ERP (code or name) and enforces the required fields for SJO modules.
 */
export const sjoCreateColumns = (input: SjoCreateInvoiceInput): Record<string, unknown> => ({
  sjo_country: input.country,
  sjo_business_unit: input.businessUnit,
  sjo_erp: input.erp,
  id_fiscal: input.idFiscal,
  ab_number: input.abNumber,
  ab_name: input.abName,
  flow_turn_down: input.flowTurnDown,
  critical_vendor: input.criticalVendor,
  urgent_invoice: input.urgentInvoice,
});

/** Invoice Details "Save" of the SJO fields; the function rejects non-SJO invoices and inactive values (CA400). */
export const saveInvoiceSjoFields = (invoiceCode: string, userId: number, input: SjoFieldsInput) =>
  saveSjoFields(invoiceCode, userId, input);
