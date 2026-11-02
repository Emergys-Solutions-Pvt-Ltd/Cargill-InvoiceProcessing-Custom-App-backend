import { signedAttachmentUrl } from '../../utils/fileUrl.js';
import { toDayFirstDateTime, toDisplayDateTime, toIsoDate, toMoney, toNumberString } from '../../utils/format.js';
import type { AttachmentRow, CcppRow, InvoiceRow, LineItemRow, SfFieldsRow, SourceEmailRow } from './invoices.repository.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const formatSize = (bytes: number | null) => {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const pdfAttachmentOf = (row: InvoiceRow) => {
  if (row.pdfAttachmentId === null) return null;
  return {
    fileName: row.pdfFileName,
    url: signedAttachmentUrl(row.pdfAttachmentId),
    title: row.pdfTitle,
    mimetype: row.pdfMimeType,
  };
};

/** Row shape used by the Invoices grid (matches the frontend mock contract). */
export const toInvoiceListItem = (row: InvoiceRow) => {
  const pdfAttachment = pdfAttachmentOf(row);
  return {
    id: row.invoiceCode,
    appId: row.moduleSlug,
    receptionDate: toIsoDate(row.receptionDate),
    emailReceptionDate: toDisplayDateTime(row.emailReceptionDate),
    invoice1a: row.invoice1a,
    invoice2a: row.invoice2a,
    countryStation: row.countryStation,
    vendorName: row.vendorName,
    cuit: row.cuit,
    status: row.status,
    amount: toMoney(row.amount),
    currencyCode: row.currencyCode,
    pdfFileName: pdfAttachment?.fileName ?? null,
    pdfUrl: pdfAttachment?.url ?? null,
    pdfAttachment,
  };
};

export const toAttachment = (att: AttachmentRow) => ({
  id: att.id,
  fileName: att.fileName,
  url: signedAttachmentUrl(att.id),
  title: att.title,
  type: att.mimeType,
  size: formatSize(att.sizeBytes),
  category: att.category,
  isPrimary: att.isPrimary,
  uploadedAt: toDisplayDateTime(att.uploadedAt),
});

const splitAddresses = (value: string | null) =>
  (value ?? '').split(',').map((a) => a.trim()).filter(Boolean);

/** Email the invoice PDF was received through (Invoice Details > PDF preview > Email). */
export const toSourceEmail = (email: SourceEmailRow) => ({
  id: email.id,
  messageId: email.messageId,
  fromName: email.fromName,
  fromAddress: email.fromAddress,
  to: splitAddresses(email.toAddresses),
  cc: splitAddresses(email.ccAddresses),
  subject: email.subject,
  body: email.bodyText ?? '',
  receivedAt: toDayFirstDateTime(email.receivedAt),
  attachments: email.attachments.map(toAttachment),
});

/**
 * Legacy Salesforce "GP Invoice" fields with no other home. Straightforward camelCase passthrough
 * of app.invoice_sf_fields' columns (confirmed with Frontend-1), nested at InvoiceDetail.sfFields;
 * null until the invoice has a row. Read-only for now - no write path exists yet.
 */
export const toSfFields = (f: SfFieldsRow) => ({
  invoice1a2aCancel: f.invoice1a2aCancel,
  firstInvoiceNumberCancel: f.firstInvoiceNumberCancel,
  secondInvoiceNumberCancel: f.secondInvoiceNumberCancel,
  abNumber: f.abNumber,
  accountingRegister: f.accountingRegister,
  codeOfImputation: f.codeOfImputation,
  codeOfImputationStr: f.codeOfImputationStr,
  gpCodeOfImputation: f.gpCodeOfImputation,
  costCenter: f.costCenter,
  jdeNumber: f.jdeNumber,
  nroDeO6: f.nroDeO6,
  poNumber: f.poNumber,
  x1Number: f.x1Number,
  ownerLegacyId: f.ownerLegacyId,
  userLegacyId: f.userLegacyId,
  adjustmentApproval: f.adjustmentApproval,
  branchPlant: f.branchPlant,
  center: f.center,
  codeType: f.codeType,
  drei: f.drei,
  adjustmentDoc: f.adjustmentDoc,
  installmentPayment: f.installmentPayment,
  invoiceType: f.invoiceType,
  orderType: f.orderType,
  pendingReason: f.pendingReason,
  rejectReason: f.rejectReason,
  subProcess: f.subProcess,
  area: f.area,
  cbsObservation: f.cbsObservation,
  computationFormula: f.computationFormula,
  expenseType: f.expenseType,
  adminObservation: f.adminObservation,
  approvalObservation: f.approvalObservation,
  attachmentNameBeforeChange: f.attachmentNameBeforeChange,
  creditNoteComments: f.creditNoteComments,
  distributionType: f.distributionType,
  notes: f.notes,
  observation: f.observation,
  rejectObservation: f.rejectObservation,
  clientEmail: f.clientEmail,
  adminApprovedDate: iso(f.adminApprovedDate),
  approvalDate: iso(f.approvalDate),
  caeExpirationDate: iso(f.caeExpirationDate),
  processedDate: iso(f.processedDate),
  rejectionDate: iso(f.rejectionDate),
  caeNumber: f.caeNumber,
  exchangeRate: f.exchangeRate,
  paymentTerm: f.paymentTerm,
  isBoortmalInvoice: f.isBoortmalInvoice,
  buEmployeeApproverDone: f.buEmployeeApproverDone,
  isDistribution: f.isDistribution,
  isDownloadedInvoice: f.isDownloadedInvoice,
  hasPo: f.hasPo,
  isHighPriority: f.isHighPriority,
  isInvoicePaid: f.isInvoicePaid,
  needApproval: f.needApproval,
  poAttached: f.poAttached,
  vipControlDone: f.vipControlDone,
  updatedAt: iso(f.updatedAt),
  cantidad: f.cantidad,
  description: f.description,
  rosCuitLegacyId: f.rosCuitLegacyId,
  dueDateInvoice: toIsoDate(f.dueDateInvoice),
  producto: f.producto,
});

/** Spanish keys are what the Invoice Overview line-item table renders. */
export const toLineItem = (item: LineItemRow) => ({
  codigo: item.code,
  descripcion: item.description,
  cantidad: toNumberString(item.quantity),
  uMedida: item.unitOfMeasure,
  precioUnit: toMoney(item.unitPrice),
  bonif: toMoney(item.discount),
  subtotal: toMoney(item.subtotal),
  alicuotaIVA: `${toNumberString(item.vatRate)}%`,
  subtotalConIVA: toMoney(item.subtotalWithVat),
});

export const toCcpp = (c: CcppRow) => ({
  id: c.id,
  producto: c.product,
  emitDocLegal: c.legalDocIssuer,
  status: c.status,
  valor: toNumberString(c.value),
  km: toNumberString(c.km),
  toneladas: toNumberString(c.tons),
  tarifaUnitaria: toNumberString(c.unitRate),
  kmFc: toNumberString(c.kmFc),
  toneladasFc: toNumberString(c.tonsFc),
});

/**
 * Full "GP CCPP" row for the Invoice Detail "CCPP" tab (/invoices/:invoiceId/ccpp routes) -
 * camelCase of the legacy Salesforce field name, same convention as sfFields. Distinct from the
 * condensed Spanish-keyed toCcpp() above, which stays as the invoice.ccpps[] embed.
 */
export const toCcppDetail = (c: CcppRow) => ({
  id: c.id,
  invoiceId: c.invoiceId,
  product: c.product,
  legalDocIssuer: c.legalDocIssuer,
  status: c.status,
  value: c.value,
  km: c.km,
  tons: c.tons,
  unitRate: c.unitRate,
  kmFc: c.kmFc,
  tonsFc: c.tonsFc,
  thirdJurisdiction: c.thirdJurisdiction,
  ab: c.ab,
  aux: c.aux,
  bp: c.bp,
  closedQuantity: c.closedQuantity,
  pendingQuantity: c.pendingQuantity,
  totalQuantity: c.totalQuantity,
  cc: c.cc,
  cia: c.cia,
  withholdingCode: c.withholdingCode,
  withholdingConcept: c.withholdingConcept,
  matching: c.matching,
  createdBy: c.createdBy === null ? null : { id: c.createdBy, name: c.createdByName },
  account: c.account,
  cuit: c.cuit,
  lineDescription: c.lineDescription,
  receiptDetail: c.receiptDetail,
  status1: c.status1,
  status2: c.status2,
  receiptDate: c.receiptDate,
  gcia: c.gcia,
  name: c.name,
  iibbDestination: c.iibbDestination,
  iibbOrigin: c.iibbOrigin,
  closedAmount: c.closedAmount,
  lineAmount: c.lineAmount,
  matchedAmount: c.matchedAmount,
  pendingAmount: c.pendingAmount,
  orderTotalAmount: c.orderTotalAmount,
  vat: c.vat,
  updatedBy: c.updatedBy === null ? null : { id: c.updatedBy, name: c.updatedByName },
  line: c.line,
  currency: c.currency,
  municipality: c.municipality,
  orderNumber: c.orderNumber,
  receiptNumber: c.receiptNumber,
  observation: c.observation,
  originDestinationDrei: c.originDestinationDrei,
  ownerLegacyId: c.ownerLegacyId,
  praclo: c.praclo,
  praptd: c.praptd,
  prdgl: c.prdgl,
  province: c.province,
  pruorg: c.pruorg,
  suss: c.suss,
  taxArea: c.taxArea,
  orderType: c.orderType,
  receiptType: c.receiptType,
  takeLine: c.takeLine,
  uniqueCcpp: c.uniqueCcpp,
  userLegacyId: c.userLegacyId,
  fiscalZone: c.fiscalZone,
});

/** Condensed columns the CCPP tab's list table renders (GP CCPP Name, Linked Invoice, CUIT, Currency, Order Total, Pending, Order Number, Status 1). */
export const toCcppListItem = (c: CcppRow) => ({
  id: c.id,
  name: c.name,
  cuit: c.cuit,
  currency: c.currency,
  orderTotalAmount: c.orderTotalAmount,
  pendingAmount: c.pendingAmount,
  orderNumber: c.orderNumber,
  status1: c.status1,
});

export const toInvoiceDetail = (
  row: InvoiceRow,
  children: {
    attachments: AttachmentRow[];
    lineItems: LineItemRow[];
    ccpps: CcppRow[];
    sourceEmail: SourceEmailRow | null;
    sfFields: SfFieldsRow | null;
  },
) => {
  const codePrefix = `INV-${row.invoicePrefix}-`;
  const suffix = row.invoiceCode.toUpperCase().startsWith(codePrefix.toUpperCase())
    ? row.invoiceCode.slice(codePrefix.length)
    : row.invoiceCode;
  return {
    ...toInvoiceListItem(row),
    formattedInvoiceId: `#IN-${row.invoicePrefix}-${suffix}`,
    applicationCode: row.applicationCode,
    firstInvoiceNumber: row.firstInvoiceNumber,
    secondInvoiceNumber: row.secondInvoiceNumber,
    vendorLegalName: row.vendorName,
    invoiceDate: toIsoDate(row.invoiceDate),
    expiryDays: row.expiryDays === null ? null : `${row.expiryDays} Days`,
    invoiceExpiryDate: toDayFirstDateTime(row.invoiceExpiryDate),
    supportTeam: row.supportTeam,
    preSettlementNumber: row.preSettlementNumber,
    creditNote: row.creditNote,
    invoiceSubtotal: toMoney(row.invoiceSubtotal ?? row.amount),
    invoiceSubtotalWithTax: toMoney(row.invoiceSubtotalWithTax),
    // Super User workflow fields (Invoice Details page)
    invoiceNumber: `IN-${row.invoicePrefix}-${suffix}`,
    emailReceptionDateTime: toDayFirstDateTime(row.emailReceptionDate),
    process: row.processId === null ? null : { id: row.processId, name: row.processName },
    origin: row.originCityId === null ? null : { id: row.originCityId, name: row.originName },
    destination: row.destinationCityId === null ? null : { id: row.destinationCityId, name: row.destinationName },
    stage: row.teamId === null ? null : { id: row.teamId, name: row.teamName },
    assignedUser: row.assignedUserId === null ? null : { id: row.assignedUserId, name: row.assignedUserName },
    claimNumber: toMoney(row.claimNumber),
    additionalInfo: row.additionalInfo,
    filenetId: row.filenetId,
    createdBy: row.createdBy === null ? null : { id: row.createdBy, name: row.createdByName },
    updatedBy: row.updatedBy === null ? null : { id: row.updatedBy, name: row.updatedByName },
    isManual: row.isManual,
    attachments: children.attachments.map(toAttachment),
    lineItems: children.lineItems.map(toLineItem),
    ccpps: children.ccpps.map(toCcpp),
    sourceEmail: children.sourceEmail ? toSourceEmail(children.sourceEmail) : null,
    sfFields: children.sfFields ? toSfFields(children.sfFields) : null,
  };
};
