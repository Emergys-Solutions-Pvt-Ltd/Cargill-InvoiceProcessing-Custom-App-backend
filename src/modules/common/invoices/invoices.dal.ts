import { callFunction, callFunctionSingle, toDate, toPageMeta, type DbDate, type PageColumns } from '../../../core/db/procedures.js';
import type { AppModule, AppSchema } from '../apps/apps.models.js';
import { mapAttachmentResult, type AttachmentResult } from '../attachments/attachments.dal.js';
import type {
  InvoiceDetail,
  InvoiceDetailsInput,
  InvoiceExtensionData,
  InvoiceListFilters,
  InvoiceRow,
  InvoiceStatus,
  LineItemRow,
  NewInvoice,
  SourceEmailRow,
} from './invoices.models.js';

// ---- Data access: <app>.usp_invoice_* - the same functions exist in each app schema (gpp, sjo,
// rospbu), generated from database/postgres/common/invoices/templates ----

// ---- Function result shapes (app.udt_*_result) ----

interface InvoiceResult {
  id: string;
  invoice_code: string;
  module_slug: string;
  invoice_prefix: string;
  application_code: string;
  invoice_1a: string | null;
  invoice_2a: string | null;
  first_invoice_number: string | null;
  second_invoice_number: string | null;
  invoice_date: DbDate | null;
  expiry_days: number | null;
  invoice_expiry_date: DbDate | null;
  support_team: boolean;
  pre_settlement_number: string | null;
  credit_note: boolean;
  currency_code: string | null;
  amount: number;
  invoice_subtotal: number | null;
  invoice_subtotal_with_tax: number | null;
  status: InvoiceStatus;
  reception_date: DbDate;
  email_reception_date: DbDate | null;
  vendor_name: string | null;
  cuit: string | null;
  country_station: string | null;
  pdf_attachment_id: string | null;
  pdf_file_name: string | null;
  pdf_title: string | null;
  pdf_mime_type: string | null;
  process_id: string | null;
  process_name: string | null;
  origin_city_id: string | null;
  origin_name: string | null;
  destination_city_id: string | null;
  destination_name: string | null;
  team_id: string | null;
  team_name: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  claim_number: number | null;
  additional_info: string | null;
  filenet_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  is_manual: boolean;
}

interface InvoiceEmailResult {
  id: string;
  message_id: string | null;
  from_name: string | null;
  from_address: string;
  to_addresses: string;
  cc_addresses: string | null;
  subject: string;
  body_text: string | null;
  received_at: DbDate;
  attachments: AttachmentResult[];
}

interface LineItemResult {
  line_no: number;
  code: string | null;
  description: string | null;
  quantity: number;
  unit_of_measure: string | null;
  unit_price: number;
  discount: number;
  subtotal: number;
  vat_rate: number;
  subtotal_with_vat: number;
}

const toInvoice = (appSchema: AppSchema, r: InvoiceResult, extensions: InvoiceExtensionData = {}): InvoiceRow => ({
  appSchema,
  extensions,
  id: r.id,
  invoiceCode: r.invoice_code,
  moduleSlug: r.module_slug,
  invoicePrefix: r.invoice_prefix,
  applicationCode: r.application_code,
  invoice1a: r.invoice_1a,
  invoice2a: r.invoice_2a,
  firstInvoiceNumber: r.first_invoice_number,
  secondInvoiceNumber: r.second_invoice_number,
  invoiceDate: toDate(r.invoice_date),
  expiryDays: r.expiry_days,
  invoiceExpiryDate: toDate(r.invoice_expiry_date),
  supportTeam: r.support_team,
  preSettlementNumber: r.pre_settlement_number,
  creditNote: r.credit_note,
  currencyCode: r.currency_code,
  amount: r.amount,
  invoiceSubtotal: r.invoice_subtotal,
  invoiceSubtotalWithTax: r.invoice_subtotal_with_tax,
  status: r.status,
  receptionDate: toDate(r.reception_date)!,
  emailReceptionDate: toDate(r.email_reception_date),
  vendorName: r.vendor_name,
  cuit: r.cuit,
  countryStation: r.country_station,
  pdfAttachmentId: r.pdf_attachment_id,
  pdfFileName: r.pdf_file_name,
  pdfTitle: r.pdf_title,
  pdfMimeType: r.pdf_mime_type,
  processId: r.process_id,
  processName: r.process_name,
  originCityId: r.origin_city_id,
  originName: r.origin_name,
  destinationCityId: r.destination_city_id,
  destinationName: r.destination_name,
  teamId: r.team_id,
  teamName: r.team_name,
  assignedUserId: r.assigned_user_id,
  assignedUserName: r.assigned_user_name,
  claimNumber: Number(r.claim_number ?? 0),
  additionalInfo: r.additional_info,
  filenetId: r.filenet_id,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  updatedBy: r.updated_by,
  updatedByName: r.updated_by_name,
  isManual: r.is_manual,
});

const toSourceEmail = (appSchema: AppSchema, r: InvoiceEmailResult): SourceEmailRow => ({
  id: r.id,
  messageId: r.message_id,
  fromName: r.from_name,
  fromAddress: r.from_address,
  toAddresses: r.to_addresses,
  ccAddresses: r.cc_addresses,
  subject: r.subject,
  bodyText: r.body_text,
  receivedAt: toDate(r.received_at)!,
  attachments: r.attachments.map((a) => mapAttachmentResult(appSchema, a)),
});

const toLineItem = (r: LineItemResult): LineItemRow => ({
  lineNo: r.line_no,
  code: r.code,
  description: r.description,
  quantity: r.quantity,
  unitOfMeasure: r.unit_of_measure,
  unitPrice: r.unit_price,
  discount: r.discount,
  subtotal: r.subtotal,
  vatRate: r.vat_rate,
  subtotalWithVat: r.subtotal_with_vat,
});

export const listInvoices = async (appModule: AppModule, f: InvoiceListFilters) => {
  // app.udt_invoice_list_result: invoice (jsonb of udt_invoice_result) + paging columns
  const rows = await callFunction<{ invoice: InvoiceResult } & PageColumns & InvoiceExtensionData>(`${appModule.appSchema}.usp_invoice_list`, {
    p_module_id: appModule.moduleId,
    p_search: f.search || null,
    p_status: f.status,
    p_page: f.page,
    p_page_size: f.limit,
  });
  return { rows: rows.map(({ invoice, total_items, total_pages, page, page_size, ...extensions }) => toInvoice(appModule.appSchema, invoice, extensions)), ...toPageMeta(rows[0], f.limit) };
};

/** Header, attachments (primary first), line items, source email and the app-specific columns in one round trip. */
export const getInvoiceDetail = async (appSchema: AppSchema, code: string): Promise<InvoiceDetail | null> => {
  // app.udt_invoice_detail_result: each column is jsonb built from the typed rows
  const [row] = await callFunction<{
    invoice: InvoiceResult;
    attachments: AttachmentResult[];
    line_items: LineItemResult[];
    source_email: InvoiceEmailResult | null;
  } & InvoiceExtensionData>(`${appSchema}.usp_invoice_get_by_code`, { p_invoice_code: code });
  if (!row) return null;
  // Every other column (sf_fields, ccpps, sjo_fields, ...) belongs to an app module's extension
  const { invoice, attachments, line_items, source_email, ...extensions } = row;
  return {
    invoice: toInvoice(appSchema, invoice, extensions),
    attachments: attachments.map((a) => mapAttachmentResult(appSchema, a)),
    lineItems: line_items.map(toLineItem),
    sourceEmail: source_email ? toSourceEmail(appSchema, source_email) : null,
  };
};

/** Keys must match the columns of app.udt_invoice_input (jsonb_populate_recordset). */
const udtInvoiceInput = (rows: NewInvoice[]) =>
  JSON.stringify(
    rows.map((r, i) => ({
      row_no: i + 1,
      invoice_code: r.invoiceCode,
      vendor_name: r.vendorName,
      cuit: r.cuit,
      country_station: r.countryStation,
      invoice_1a: r.invoice1a,
      invoice_2a: r.invoice2a,
      amount: r.amount,
      status: r.status,
      reception_date: r.receptionDate.toISOString().slice(0, 10),
      email_reception_date: r.emailReceptionDate?.toISOString() ?? null,
      assigned_user_id: r.assignedUserId,
      ...r.extraColumns,
    })),
  );

/**
 * All-or-nothing insert; creates missing vendors (by CUIT) and stations; app-specific columns
 * (extraColumns) are validated and stored by the function (e.g. SJO fields).
 * Raises CA400 (bad input / duplicate ids in request) or CA409 (id exists, daily limit).
 * Returns the created invoice codes in request order.
 */
export const insertInvoices = async (appModule: AppModule, invoices: NewInvoice[], userId: string): Promise<string[]> => {
  const rows = await callFunction<{ code: string }>(`${appModule.appSchema}.usp_invoice_create_batch`, {
    p_module_id: appModule.moduleId,
    p_created_by: userId,
    p_invoices: udtInvoiceInput(invoices),
  });
  return rows.map((r) => r.code);
};

/** Raises CA400 for an unknown / inactive status code, CA404 when the invoice does not exist. */
export const updateInvoiceStatus = async (appSchema: AppSchema, code: string, status: InvoiceStatus) => {
  await callFunctionSingle(`${appSchema}.usp_invoice_update_status`, { p_invoice_code: code, p_status: status });
};

/** Invoice Details "Save". NULL clears a field. Raises CA400 (unknown / inactive reference), CA404. */
export const updateInvoiceDetails = async (appSchema: AppSchema, code: string, userId: string, input: InvoiceDetailsInput) => {
  await callFunctionSingle(`${appSchema}.usp_invoice_update_details`, {
    p_invoice_code: code,
    p_process_id: input.processId,
    p_origin_city_id: input.originCityId,
    p_destination_city_id: input.destinationCityId,
    p_claim_number: input.claimNumber,
    p_additional_info: input.additionalInfo,
    p_assigned_user_id: input.assignedUserId,
    p_updated_by: userId,
  });
};

/** Moves the invoice to the previous team (queue). Raises CA404, CA409 (no team / already first). */
export const sendToPreviousTeam = async (appSchema: AppSchema, code: string): Promise<{ id: string; name: string }> => {
  const team = await callFunctionSingle<{ id: string; name: string }>(`${appSchema}.usp_invoice_send_to_previous_team`, {
    p_invoice_code: code,
  });
  return { id: team.id, name: team.name };
};
