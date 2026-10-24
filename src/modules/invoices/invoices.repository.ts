import { callFunction, callFunctionSingle, toPageMeta, udtInvoiceInput, type InvoiceInputRow, type PageColumns } from '../../db/procedures.js';

/** A code from app.statuses (Settings > Configuration > Statuses), e.g. 'Pending'. */
export type InvoiceStatus = string;

export interface InvoiceRow {
  id: number;
  invoiceCode: string;
  moduleSlug: string;
  invoicePrefix: string;
  applicationCode: string;
  invoice1a: string | null;
  invoice2a: string | null;
  firstInvoiceNumber: string | null;
  secondInvoiceNumber: string | null;
  invoiceDate: Date | null;
  expiryDays: number | null;
  invoiceExpiryDate: Date | null;
  supportTeam: boolean;
  preSettlementNumber: string | null;
  creditNote: boolean;
  amount: number;
  invoiceSubtotal: number | null;
  invoiceSubtotalWithTax: number | null;
  status: InvoiceStatus;
  receptionDate: Date;
  emailReceptionDate: Date | null;
  vendorName: string;
  cuit: string;
  countryStation: string | null;
  pdfAttachmentId: number | null;
  pdfFileName: string | null;
  pdfTitle: string | null;
  pdfMimeType: string | null;
  // Workflow / Super User fields (Invoice Details page)
  processId: number | null;
  processName: string | null;
  originCityId: number | null;
  originName: string | null;
  destinationCityId: number | null;
  destinationName: string | null;
  teamId: number | null;
  teamName: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  claimNumber: number;
  additionalInfo: string | null;
  filenetId: string | null;
}

export interface AttachmentRow {
  id: number;
  fileName: string;
  title: string | null;
  category: string;
  mimeType: string;
  sizeBytes: number | null;
  storagePath: string;
  isPrimary: boolean;
  uploadedAt: Date;
  invoiceId: number;
  applicationCode: string;
}

export interface LineItemRow {
  lineNo: number;
  code: string | null;
  description: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  unitPrice: number;
  discount: number;
  subtotal: number;
  vatRate: number;
  subtotalWithVat: number;
}

export interface CcppRow {
  id: number;
  product: string;
  legalDocIssuer: string | null;
  status: string;
  value: number | null;
  km: number | null;
  tons: number | null;
  unitRate: number | null;
  kmFc: number | null;
  tonsFc: number | null;
}

/** The email the invoice PDF was received through (app.invoice_source_emails). */
export interface SourceEmailRow {
  id: number;
  messageId: string | null;
  fromName: string | null;
  fromAddress: string;
  toAddresses: string;
  ccAddresses: string | null;
  subject: string;
  bodyText: string | null;
  receivedAt: Date;
  attachments: AttachmentRow[];
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  attachments: AttachmentRow[];
  lineItems: LineItemRow[];
  ccpps: CcppRow[];
  sourceEmail: SourceEmailRow | null;
}

// ---- Function result shapes (app.udt_*_result) ----

/**
 * Typed columns arrive as Date (see db/pool.ts); values nested in the jsonb columns of
 * udt_invoice_list_result / udt_invoice_detail_result arrive as ISO strings.
 */
type DbDate = Date | string;

const toDate = (value: DbDate | null): Date | null => {
  if (value === null || value instanceof Date) return value;
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
};

interface InvoiceResult {
  id: number;
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
  amount: number;
  invoice_subtotal: number | null;
  invoice_subtotal_with_tax: number | null;
  status: InvoiceStatus;
  reception_date: DbDate;
  email_reception_date: DbDate | null;
  vendor_name: string;
  cuit: string;
  country_station: string | null;
  pdf_attachment_id: number | null;
  pdf_file_name: string | null;
  pdf_title: string | null;
  pdf_mime_type: string | null;
  process_id: number | null;
  process_name: string | null;
  origin_city_id: number | null;
  origin_name: string | null;
  destination_city_id: number | null;
  destination_name: string | null;
  team_id: number | null;
  team_name: string | null;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  claim_number: number | null;
  additional_info: string | null;
  filenet_id: string | null;
}

interface AttachmentResult {
  id: number;
  invoice_id: number;
  file_name: string;
  title: string | null;
  category: string;
  mime_type: string;
  size_bytes: number | null;
  storage_path: string;
  is_primary: boolean;
  uploaded_at: DbDate;
  application_code: string;
}

interface InvoiceEmailResult {
  id: number;
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

interface CcppResult {
  id: number;
  product: string;
  legal_doc_issuer: string | null;
  status: string;
  value: number | null;
  km: number | null;
  tons: number | null;
  unit_rate: number | null;
  km_fc: number | null;
  tons_fc: number | null;
}

const toInvoice = (r: InvoiceResult): InvoiceRow => ({
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
});

const toAttachment = (r: AttachmentResult): AttachmentRow => ({
  id: r.id,
  invoiceId: r.invoice_id,
  fileName: r.file_name,
  title: r.title,
  category: r.category,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  storagePath: r.storage_path,
  isPrimary: r.is_primary,
  uploadedAt: toDate(r.uploaded_at)!,
  applicationCode: r.application_code,
});

const toSourceEmail = (r: InvoiceEmailResult): SourceEmailRow => ({
  id: r.id,
  messageId: r.message_id,
  fromName: r.from_name,
  fromAddress: r.from_address,
  toAddresses: r.to_addresses,
  ccAddresses: r.cc_addresses,
  subject: r.subject,
  bodyText: r.body_text,
  receivedAt: toDate(r.received_at)!,
  attachments: r.attachments.map(toAttachment),
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

const toCcpp = (r: CcppResult): CcppRow => ({
  id: r.id,
  product: r.product,
  legalDocIssuer: r.legal_doc_issuer,
  status: r.status,
  value: r.value,
  km: r.km,
  tons: r.tons,
  unitRate: r.unit_rate,
  kmFc: r.km_fc,
  tonsFc: r.tons_fc,
});

export interface InvoiceListFilters {
  search: string;
  status: string;
  page: number;
  limit: number;
}

export const listInvoices = async (moduleId: number, f: InvoiceListFilters) => {
  // app.udt_invoice_list_result: invoice (jsonb of udt_invoice_result) + paging columns
  const rows = await callFunction<{ invoice: InvoiceResult } & PageColumns>('usp_invoice_list', {
    p_module_id: moduleId,
    p_search: f.search || null,
    p_status: f.status,
    p_page: f.page,
    p_page_size: f.limit,
  });
  return { rows: rows.map((r) => toInvoice(r.invoice)), ...toPageMeta(rows[0], f.limit) };
};

/** Header, attachments (primary first), line items, CCPPs and source email in one round trip. */
export const getInvoiceDetail = async (code: string): Promise<InvoiceDetail | null> => {
  // app.udt_invoice_detail_result: each column is jsonb built from the typed rows
  const [row] = await callFunction<{
    invoice: InvoiceResult;
    attachments: AttachmentResult[];
    line_items: LineItemResult[];
    ccpps: CcppResult[];
    source_email: InvoiceEmailResult | null;
  }>('usp_invoice_get_by_code', { p_invoice_code: code });
  if (!row) return null;
  return {
    invoice: toInvoice(row.invoice),
    attachments: row.attachments.map(toAttachment),
    lineItems: row.line_items.map(toLineItem),
    ccpps: row.ccpps.map(toCcpp),
    sourceEmail: row.source_email ? toSourceEmail(row.source_email) : null,
  };
};

export const findAttachmentById = async (id: number): Promise<AttachmentRow | null> => {
  const [row] = await callFunction<AttachmentResult>('usp_attachment_get_by_id', { p_attachment_id: id });
  return row ? toAttachment(row) : null;
};

export type NewInvoice = InvoiceInputRow & { status: InvoiceStatus };

/**
 * All-or-nothing insert; creates missing vendors (by CUIT) and stations.
 * Raises CA400 (bad input / duplicate ids in request) or CA409 (id exists, daily limit).
 * Returns the created invoice codes in request order.
 */
export const insertInvoices = async (moduleId: number, invoices: NewInvoice[], userId: number): Promise<string[]> => {
  const rows = await callFunction<{ code: string }>('usp_invoice_create_batch', {
    p_module_id: moduleId,
    p_created_by: userId,
    p_invoices: udtInvoiceInput(invoices),
  });
  return rows.map((r) => r.code);
};

/** Raises CA400 for an unknown / inactive status code, CA404 when the invoice does not exist. */
export const updateInvoiceStatus = async (code: string, status: InvoiceStatus) => {
  await callFunctionSingle('usp_invoice_update_status', { p_invoice_code: code, p_status: status });
};

export interface InvoiceDetailsInput {
  processId: number | null;
  originCityId: number | null;
  destinationCityId: number | null;
  claimNumber: number;
  additionalInfo: string | null;
  assignedUserId: number | null;
}

/** Invoice Details "Save". NULL clears a field. Raises CA400 (unknown / inactive reference), CA404. */
export const updateInvoiceDetails = async (code: string, input: InvoiceDetailsInput) => {
  await callFunctionSingle('usp_invoice_update_details', {
    p_invoice_code: code,
    p_process_id: input.processId,
    p_origin_city_id: input.originCityId,
    p_destination_city_id: input.destinationCityId,
    p_claim_number: input.claimNumber,
    p_additional_info: input.additionalInfo,
    p_assigned_user_id: input.assignedUserId,
  });
};

/** Moves the invoice to the previous team (queue). Raises CA404, CA409 (no team / already first). */
export const sendToPreviousTeam = async (code: string): Promise<{ id: number; name: string }> => {
  const team = await callFunctionSingle<{ id: number; name: string }>('usp_invoice_send_to_previous_team', {
    p_invoice_code: code,
  });
  return { id: team.id, name: team.name };
};

export interface NewAttachment {
  fileName: string;
  title: string | null;
  category: string | null;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  isPrimary: boolean;
}

/** Registers an already stored file. Raises CA404 when the invoice does not exist. */
export const addAttachment = async (code: string, file: NewAttachment): Promise<AttachmentRow> =>
  toAttachment(
    await callFunctionSingle<AttachmentResult>('usp_attachment_add', {
      p_invoice_code: code,
      p_file_name: file.fileName,
      p_title: file.title,
      p_category: file.category,
      p_mime_type: file.mimeType,
      p_size_bytes: file.sizeBytes,
      p_storage_path: file.storagePath,
      p_is_primary: file.isPrimary,
    }),
  );
