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
  currencyCode: string | null;
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
  createdBy: number | null;
  createdByName: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  isManual: boolean;
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

/**
 * CCPP tab (app.invoice_ccpps) - the original 9 columns plus the legacy Salesforce "GP CCPP"
 * fields (52 of the 55 export fields; Link Invoice / Link Invoice CUIT / Linked Invoice Name are
 * not stored, see the table's UPGRADES comment). Element of both InvoiceDetail.ccpps and the
 * standalone /invoices/:invoiceId/ccpp CRUD routes.
 */
export interface CcppRow {
  id: number;
  invoiceId: number;
  product: string;
  legalDocIssuer: string | null;
  status: string;
  value: number | null;
  km: number | null;
  tons: number | null;
  unitRate: number | null;
  kmFc: number | null;
  tonsFc: number | null;
  thirdJurisdiction: string | null;
  ab: string | null;
  aux: string | null;
  bp: string | null;
  closedQuantity: number | null;
  pendingQuantity: number | null;
  totalQuantity: number | null;
  cc: string | null;
  cia: string | null;
  withholdingCode: string | null;
  withholdingConcept: string | null;
  matching: string | null;
  createdBy: number | null;
  createdByName: string | null;
  account: string | null;
  cuit: string | null;
  lineDescription: string | null;
  receiptDetail: string | null;
  status1: string | null;
  status2: string | null;
  receiptDate: string | null;
  gcia: string | null;
  name: string | null;
  iibbDestination: string | null;
  iibbOrigin: string | null;
  closedAmount: string | null;
  lineAmount: number | null;
  matchedAmount: string | null;
  pendingAmount: number | null;
  orderTotalAmount: number | null;
  vat: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  line: number | null;
  currency: string | null;
  municipality: string | null;
  orderNumber: string | null;
  receiptNumber: string | null;
  observation: string | null;
  originDestinationDrei: string | null;
  ownerLegacyId: string | null;
  praclo: string | null;
  praptd: string | null;
  prdgl: string | null;
  province: string | null;
  pruorg: string | null;
  suss: string | null;
  taxArea: string | null;
  orderType: string | null;
  receiptType: string | null;
  takeLine: string | null;
  uniqueCcpp: string | null;
  userLegacyId: string | null;
  fiscalZone: string | null;
}

/** Legacy Salesforce "GP Invoice" fields with no other home (app.invoice_sf_fields), lazily created - null until the invoice has a row. */
export interface SfFieldsRow {
  invoice1a2aCancel: string | null;
  firstInvoiceNumberCancel: string | null;
  secondInvoiceNumberCancel: string | null;
  abNumber: string | null;
  accountingRegister: number | null;
  codeOfImputation: string | null;
  codeOfImputationStr: string | null;
  gpCodeOfImputation: string | null;
  costCenter: number | null;
  jdeNumber: string | null;
  nroDeO6: string | null;
  poNumber: string | null;
  x1Number: string | null;
  ownerLegacyId: string | null;
  userLegacyId: string | null;
  adjustmentApproval: string | null;
  branchPlant: string | null;
  center: string | null;
  codeType: string | null;
  drei: string | null;
  adjustmentDoc: string | null;
  installmentPayment: string | null;
  invoiceType: string | null;
  orderType: string | null;
  pendingReason: string | null;
  rejectReason: string | null;
  subProcess: string | null;
  area: string | null;
  cbsObservation: string | null;
  computationFormula: string | null;
  expenseType: string | null;
  adminObservation: string | null;
  approvalObservation: string | null;
  attachmentNameBeforeChange: string | null;
  creditNoteComments: string | null;
  distributionType: string | null;
  notes: string | null;
  observation: string | null;
  rejectObservation: string | null;
  clientEmail: string | null;
  adminApprovedDate: Date | null;
  approvalDate: Date | null;
  caeExpirationDate: Date | null;
  processedDate: Date | null;
  rejectionDate: Date | null;
  caeNumber: number | null;
  exchangeRate: number | null;
  paymentTerm: number | null;
  isBoortmalInvoice: boolean;
  buEmployeeApproverDone: boolean;
  isDistribution: boolean;
  isDownloadedInvoice: boolean;
  hasPo: boolean;
  isHighPriority: boolean;
  isInvoicePaid: boolean;
  needApproval: boolean;
  poAttached: boolean;
  vipControlDone: boolean;
  updatedAt: Date;
  cantidad: number | null;
  description: string | null;
  rosCuitLegacyId: string | null;
  dueDateInvoice: Date | null;
  producto: string | null;
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
  sfFields: SfFieldsRow | null;
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
  currency_code: string | null;
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
  created_by: number | null;
  created_by_name: string | null;
  updated_by: number | null;
  updated_by_name: string | null;
  is_manual: boolean;
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

// app.udt_invoice_sf_fields_result (NULL until app.invoice_sf_fields has a row for this invoice)
interface SfFieldsResult {
  invoice_1a_2a_cancel: string | null;
  first_invoice_number_cancel: string | null;
  second_invoice_number_cancel: string | null;
  ab_number: string | null;
  accounting_register: number | null;
  code_of_imputation: string | null;
  code_of_imputation_str: string | null;
  gp_code_of_imputation: string | null;
  cost_center: number | null;
  jde_number: string | null;
  nro_de_o6: string | null;
  po_number: string | null;
  x1_number: string | null;
  owner_legacy_id: string | null;
  user_legacy_id: string | null;
  adjustment_approval: string | null;
  branch_plant: string | null;
  center: string | null;
  code_type: string | null;
  drei: string | null;
  adjustment_doc: string | null;
  installment_payment: string | null;
  invoice_type: string | null;
  order_type: string | null;
  pending_reason: string | null;
  reject_reason: string | null;
  sub_process: string | null;
  area: string | null;
  cbs_observation: string | null;
  computation_formula: string | null;
  expense_type: string | null;
  admin_observation: string | null;
  approval_observation: string | null;
  attachment_name_before_change: string | null;
  credit_note_comments: string | null;
  distribution_type: string | null;
  notes: string | null;
  observation: string | null;
  reject_observation: string | null;
  client_email: string | null;
  admin_approved_date: DbDate | null;
  approval_date: DbDate | null;
  cae_expiration_date: DbDate | null;
  processed_date: DbDate | null;
  rejection_date: DbDate | null;
  cae_number: number | null;
  exchange_rate: number | null;
  payment_term: number | null;
  is_boortmal_invoice: boolean;
  bu_employee_approver_done: boolean;
  is_distribution: boolean;
  is_downloaded_invoice: boolean;
  has_po: boolean;
  is_high_priority: boolean;
  is_invoice_paid: boolean;
  need_approval: boolean;
  po_attached: boolean;
  vip_control_done: boolean;
  updated_at: DbDate;
  cantidad: number | null;
  description: string | null;
  ros_cuit_legacy_id: string | null;
  due_date_invoice: DbDate | null;
  producto: string | null;
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

// app.udt_ccpp_result
interface CcppResult {
  id: number;
  invoice_id: number;
  product: string;
  legal_doc_issuer: string | null;
  status: string;
  value: number | null;
  km: number | null;
  tons: number | null;
  unit_rate: number | null;
  km_fc: number | null;
  tons_fc: number | null;
  third_jurisdiction: string | null;
  ab: string | null;
  aux: string | null;
  bp: string | null;
  closed_quantity: number | null;
  pending_quantity: number | null;
  total_quantity: number | null;
  cc: string | null;
  cia: string | null;
  withholding_code: string | null;
  withholding_concept: string | null;
  matching: string | null;
  created_by: number | null;
  created_by_name: string | null;
  account: string | null;
  cuit: string | null;
  line_description: string | null;
  receipt_detail: string | null;
  status1: string | null;
  status2: string | null;
  receipt_date: string | null;
  gcia: string | null;
  name: string | null;
  iibb_destination: string | null;
  iibb_origin: string | null;
  closed_amount: string | null;
  line_amount: number | null;
  matched_amount: string | null;
  pending_amount: number | null;
  order_total_amount: number | null;
  vat: string | null;
  updated_by: number | null;
  updated_by_name: string | null;
  line: number | null;
  currency: string | null;
  municipality: string | null;
  order_number: string | null;
  receipt_number: string | null;
  observation: string | null;
  origin_destination_drei: string | null;
  owner_legacy_id: string | null;
  praclo: string | null;
  praptd: string | null;
  prdgl: string | null;
  province: string | null;
  pruorg: string | null;
  suss: string | null;
  tax_area: string | null;
  order_type: string | null;
  receipt_type: string | null;
  take_line: string | null;
  unique_ccpp: string | null;
  user_legacy_id: string | null;
  fiscal_zone: string | null;
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

const toSfFields = (r: SfFieldsResult): SfFieldsRow => ({
  invoice1a2aCancel: r.invoice_1a_2a_cancel,
  firstInvoiceNumberCancel: r.first_invoice_number_cancel,
  secondInvoiceNumberCancel: r.second_invoice_number_cancel,
  abNumber: r.ab_number,
  accountingRegister: r.accounting_register,
  codeOfImputation: r.code_of_imputation,
  codeOfImputationStr: r.code_of_imputation_str,
  gpCodeOfImputation: r.gp_code_of_imputation,
  costCenter: r.cost_center,
  jdeNumber: r.jde_number,
  nroDeO6: r.nro_de_o6,
  poNumber: r.po_number,
  x1Number: r.x1_number,
  ownerLegacyId: r.owner_legacy_id,
  userLegacyId: r.user_legacy_id,
  adjustmentApproval: r.adjustment_approval,
  branchPlant: r.branch_plant,
  center: r.center,
  codeType: r.code_type,
  drei: r.drei,
  adjustmentDoc: r.adjustment_doc,
  installmentPayment: r.installment_payment,
  invoiceType: r.invoice_type,
  orderType: r.order_type,
  pendingReason: r.pending_reason,
  rejectReason: r.reject_reason,
  subProcess: r.sub_process,
  area: r.area,
  cbsObservation: r.cbs_observation,
  computationFormula: r.computation_formula,
  expenseType: r.expense_type,
  adminObservation: r.admin_observation,
  approvalObservation: r.approval_observation,
  attachmentNameBeforeChange: r.attachment_name_before_change,
  creditNoteComments: r.credit_note_comments,
  distributionType: r.distribution_type,
  notes: r.notes,
  observation: r.observation,
  rejectObservation: r.reject_observation,
  clientEmail: r.client_email,
  adminApprovedDate: toDate(r.admin_approved_date),
  approvalDate: toDate(r.approval_date),
  caeExpirationDate: toDate(r.cae_expiration_date),
  processedDate: toDate(r.processed_date),
  rejectionDate: toDate(r.rejection_date),
  caeNumber: r.cae_number,
  exchangeRate: r.exchange_rate,
  paymentTerm: r.payment_term,
  isBoortmalInvoice: r.is_boortmal_invoice,
  buEmployeeApproverDone: r.bu_employee_approver_done,
  isDistribution: r.is_distribution,
  isDownloadedInvoice: r.is_downloaded_invoice,
  hasPo: r.has_po,
  isHighPriority: r.is_high_priority,
  isInvoicePaid: r.is_invoice_paid,
  needApproval: r.need_approval,
  poAttached: r.po_attached,
  vipControlDone: r.vip_control_done,
  updatedAt: toDate(r.updated_at)!,
  cantidad: r.cantidad,
  description: r.description,
  rosCuitLegacyId: r.ros_cuit_legacy_id,
  dueDateInvoice: toDate(r.due_date_invoice),
  producto: r.producto,
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
  invoiceId: r.invoice_id,
  product: r.product,
  legalDocIssuer: r.legal_doc_issuer,
  status: r.status,
  value: r.value,
  km: r.km,
  tons: r.tons,
  unitRate: r.unit_rate,
  kmFc: r.km_fc,
  tonsFc: r.tons_fc,
  thirdJurisdiction: r.third_jurisdiction,
  ab: r.ab,
  aux: r.aux,
  bp: r.bp,
  closedQuantity: r.closed_quantity,
  pendingQuantity: r.pending_quantity,
  totalQuantity: r.total_quantity,
  cc: r.cc,
  cia: r.cia,
  withholdingCode: r.withholding_code,
  withholdingConcept: r.withholding_concept,
  matching: r.matching,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  account: r.account,
  cuit: r.cuit,
  lineDescription: r.line_description,
  receiptDetail: r.receipt_detail,
  status1: r.status1,
  status2: r.status2,
  receiptDate: r.receipt_date,
  gcia: r.gcia,
  name: r.name,
  iibbDestination: r.iibb_destination,
  iibbOrigin: r.iibb_origin,
  closedAmount: r.closed_amount,
  lineAmount: r.line_amount,
  matchedAmount: r.matched_amount,
  pendingAmount: r.pending_amount,
  orderTotalAmount: r.order_total_amount,
  vat: r.vat,
  updatedBy: r.updated_by,
  updatedByName: r.updated_by_name,
  line: r.line,
  currency: r.currency,
  municipality: r.municipality,
  orderNumber: r.order_number,
  receiptNumber: r.receipt_number,
  observation: r.observation,
  originDestinationDrei: r.origin_destination_drei,
  ownerLegacyId: r.owner_legacy_id,
  praclo: r.praclo,
  praptd: r.praptd,
  prdgl: r.prdgl,
  province: r.province,
  pruorg: r.pruorg,
  suss: r.suss,
  taxArea: r.tax_area,
  orderType: r.order_type,
  receiptType: r.receipt_type,
  takeLine: r.take_line,
  uniqueCcpp: r.unique_ccpp,
  userLegacyId: r.user_legacy_id,
  fiscalZone: r.fiscal_zone,
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

/** Header, attachments (primary first), line items, CCPPs, source email and legacy SF fields in one round trip. */
export const getInvoiceDetail = async (code: string): Promise<InvoiceDetail | null> => {
  // app.udt_invoice_detail_result: each column is jsonb built from the typed rows
  const [row] = await callFunction<{
    invoice: InvoiceResult;
    attachments: AttachmentResult[];
    line_items: LineItemResult[];
    ccpps: CcppResult[];
    source_email: InvoiceEmailResult | null;
    sf_fields: SfFieldsResult | null;
  }>('usp_invoice_get_by_code', { p_invoice_code: code });
  if (!row) return null;
  return {
    invoice: toInvoice(row.invoice),
    attachments: row.attachments.map(toAttachment),
    lineItems: row.line_items.map(toLineItem),
    ccpps: row.ccpps.map(toCcpp),
    sourceEmail: row.source_email ? toSourceEmail(row.source_email) : null,
    sfFields: row.sf_fields ? toSfFields(row.sf_fields) : null,
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

/** GP Invoice Detail "CCPP" tab: all CCPP rows for an invoice. Raises CA404 when the invoice does not exist. */
export const listCcpps = async (code: string): Promise<CcppRow[]> => {
  const rows = await callFunction<CcppResult>('usp_ccpp_list', { p_invoice_code: code });
  return rows.map(toCcpp);
};

export interface CcppInput {
  product: string;
  status: string;
  legalDocIssuer: string | null;
  value: number | null;
  km: number | null;
  tons: number | null;
  unitRate: number | null;
  kmFc: number | null;
  tonsFc: number | null;
  thirdJurisdiction: string | null;
  ab: string | null;
  aux: string | null;
  bp: string | null;
  closedQuantity: number | null;
  pendingQuantity: number | null;
  totalQuantity: number | null;
  cc: string | null;
  cia: string | null;
  withholdingCode: string | null;
  withholdingConcept: string | null;
  matching: string | null;
  account: string | null;
  cuit: string | null;
  lineDescription: string | null;
  receiptDetail: string | null;
  status1: string | null;
  status2: string | null;
  receiptDate: string | null;
  gcia: string | null;
  name: string | null;
  iibbDestination: string | null;
  iibbOrigin: string | null;
  closedAmount: string | null;
  lineAmount: number | null;
  matchedAmount: string | null;
  pendingAmount: number | null;
  orderTotalAmount: number | null;
  vat: string | null;
  line: number | null;
  currency: string | null;
  municipality: string | null;
  orderNumber: string | null;
  receiptNumber: string | null;
  observation: string | null;
  originDestinationDrei: string | null;
  ownerLegacyId: string | null;
  praclo: string | null;
  praptd: string | null;
  prdgl: string | null;
  province: string | null;
  pruorg: string | null;
  suss: string | null;
  taxArea: string | null;
  orderType: string | null;
  receiptType: string | null;
  takeLine: string | null;
  uniqueCcpp: string | null;
  userLegacyId: string | null;
  fiscalZone: string | null;
}

/**
 * GP Invoice Detail "CCPP" tab: add (ccppId omitted/null) or update (ccppId given) one row.
 * Raises CA400 (missing product/status, unknown acting user), CA404 (invoice not found, or on
 * update, the CCPP row doesn't exist / belongs to another invoice).
 */
export const saveCcpp = async (code: string, userId: number, input: CcppInput, ccppId: number | null = null): Promise<CcppRow> =>
  toCcpp(
    await callFunctionSingle<CcppResult>('usp_ccpp_save', {
      p_invoice_code: code,
      p_user_id: userId,
      p_product: input.product,
      p_status: input.status,
      p_id: ccppId,
      p_legal_doc_issuer: input.legalDocIssuer,
      p_value: input.value,
      p_km: input.km,
      p_tons: input.tons,
      p_unit_rate: input.unitRate,
      p_km_fc: input.kmFc,
      p_tons_fc: input.tonsFc,
      p_third_jurisdiction: input.thirdJurisdiction,
      p_ab: input.ab,
      p_aux: input.aux,
      p_bp: input.bp,
      p_closed_quantity: input.closedQuantity,
      p_pending_quantity: input.pendingQuantity,
      p_total_quantity: input.totalQuantity,
      p_cc: input.cc,
      p_cia: input.cia,
      p_withholding_code: input.withholdingCode,
      p_withholding_concept: input.withholdingConcept,
      p_matching: input.matching,
      p_account: input.account,
      p_cuit: input.cuit,
      p_line_description: input.lineDescription,
      p_receipt_detail: input.receiptDetail,
      p_status1: input.status1,
      p_status2: input.status2,
      p_receipt_date: input.receiptDate,
      p_gcia: input.gcia,
      p_name: input.name,
      p_iibb_destination: input.iibbDestination,
      p_iibb_origin: input.iibbOrigin,
      p_closed_amount: input.closedAmount,
      p_line_amount: input.lineAmount,
      p_matched_amount: input.matchedAmount,
      p_pending_amount: input.pendingAmount,
      p_order_total_amount: input.orderTotalAmount,
      p_vat: input.vat,
      p_line: input.line,
      p_currency: input.currency,
      p_municipality: input.municipality,
      p_order_number: input.orderNumber,
      p_receipt_number: input.receiptNumber,
      p_observation: input.observation,
      p_origin_destination_drei: input.originDestinationDrei,
      p_owner_legacy_id: input.ownerLegacyId,
      p_praclo: input.praclo,
      p_praptd: input.praptd,
      p_prdgl: input.prdgl,
      p_province: input.province,
      p_pruorg: input.pruorg,
      p_suss: input.suss,
      p_tax_area: input.taxArea,
      p_order_type: input.orderType,
      p_receipt_type: input.receiptType,
      p_take_line: input.takeLine,
      p_unique_ccpp: input.uniqueCcpp,
      p_user_legacy_id: input.userLegacyId,
      p_fiscal_zone: input.fiscalZone,
    }),
  );
