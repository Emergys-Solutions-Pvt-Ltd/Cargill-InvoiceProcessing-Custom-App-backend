import { signedAttachmentUrl } from '../../utils/fileUrl.js';
import { toDayFirstDateTime, toDisplayDateTime, toIsoDate, toMoney, toNumberString } from '../../utils/format.js';
import type { AttachmentRow, CcppRow, InvoiceRow, LineItemRow } from './invoices.repository.js';

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

export const toInvoiceDetail = (
  row: InvoiceRow,
  children: { attachments: AttachmentRow[]; lineItems: LineItemRow[]; ccpps: CcppRow[] },
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
    attachments: children.attachments.map(toAttachment),
    lineItems: children.lineItems.map(toLineItem),
    ccpps: children.ccpps.map(toCcpp),
  };
};
