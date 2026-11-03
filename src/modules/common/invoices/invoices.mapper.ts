import { signedAttachmentUrl } from '../../../core/utils/file-url.js';
import { toDayFirstDateTime, toDisplayDateTime, toIsoDate, toMoney, toNumberString } from '../../../core/utils/format.js';
import { toAttachment } from '../attachments/attachments.mapper.js';
import { invoiceExtensions } from './invoice-extensions.js';
import type { InvoiceDetail, InvoiceRow, LineItemRow, SourceEmailRow } from './invoices.models.js';

// ---- DTOs: invoices as the API returns them; app extensions add their own fields ----

const pdfAttachmentOf = (row: InvoiceRow) => {
  if (row.pdfAttachmentId === null) return null;
  return {
    fileName: row.pdfFileName,
    url: signedAttachmentUrl(row.appSchema, row.pdfAttachmentId),
    title: row.pdfTitle,
    mimetype: row.pdfMimeType,
  };
};

/** Fields every registered app extension adds (e.g. sjoFields, sfFields, ccpps). */
const extensionFields = (row: InvoiceRow, kind: 'listFields' | 'detailFields') =>
  Object.assign({}, ...invoiceExtensions().map((ext) => ext[kind]?.(row.extensions) ?? {}));

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
    assignedUser: row.assignedUserId === null ? null : { id: row.assignedUserId, name: row.assignedUserName },
    ...extensionFields(row, 'listFields'),
  };
};

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

export const toInvoiceDetail = ({ invoice: row, attachments, lineItems, sourceEmail }: InvoiceDetail) => {
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
    attachments: attachments.map(toAttachment),
    lineItems: lineItems.map(toLineItem),
    sourceEmail: sourceEmail ? toSourceEmail(sourceEmail) : null,
    ...extensionFields(row, 'detailFields'),
  };
};
