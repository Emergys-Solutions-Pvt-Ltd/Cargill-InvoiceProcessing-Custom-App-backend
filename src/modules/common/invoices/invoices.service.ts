import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { HttpError } from '../../../core/http/http-error.js';
import type { AppModule, AppSchema } from '../apps/apps.models.js';
import { attachmentStorage } from '../attachments/storage/index.js';
import { invoiceExtensionFor, invoiceExtensions } from './invoice-extensions.js';
import {
  getInvoiceDetail,
  insertInvoices,
  listInvoices,
  sendToPreviousTeam,
  updateInvoiceDetails,
  updateInvoiceStatus,
} from './invoices.dal.js';
import type { InvoiceDetail, InvoiceListFilters, NewInvoice } from './invoices.models.js';
import { createInvoiceSchema, invoiceDetailsBody, MAX_BULK_INVOICES, type CreateInvoiceInput } from './invoices.schemas.js';

// ---- Business rules of the common invoice flow; app-specific rules come from the app extensions.
// Every app keeps its invoices in its own schema (AppModule.appSchema); invoice codes are unique per
// app, so an invoice is always addressed through its app (the route's :appId, checked by requireAppAccess).

/** The app's invoice (detail); 404 when the code does not exist in that app. */
export const getAppInvoice = async (appModule: AppModule, code: string): Promise<InvoiceDetail> => {
  const detail = await getInvoiceDetail(appModule.appSchema, code);
  if (!detail) throw HttpError.notFound(`Invoice '${code}' not found in ${appModule.name}`);
  return detail;
};

export const listAppInvoices = (appModule: AppModule, filters: InvoiceListFilters) => listInvoices(appModule, filters);

// ---- Create Invoice / Bulk Upload

/** The app's own create schema (e.g. SJO), else the common one (vendor, CUIT, amount required). */
export const createSchemaFor = (appModule: AppModule): z.ZodType<CreateInvoiceInput> =>
  invoiceExtensionFor(appModule.applicationCode)?.create?.schema ?? createInvoiceSchema;

export const bulkCreateSchemaFor = (appModule: AppModule) =>
  z.object({ invoices: z.array(createSchemaFor(appModule)).min(1).max(MAX_BULK_INVOICES) });

const toNewInvoice = (appModule: AppModule, input: CreateInvoiceInput): NewInvoice => ({
  invoiceCode: input.id ?? `INV-${appModule.invoicePrefix}-${crypto.randomInt(100000, 1000000)}`,
  vendorName: input.vendorName,
  cuit: input.cuit,
  countryStation: input.countryStation ?? null,
  invoice1a: input.invoice1a ?? null,
  invoice2a: input.invoice2a ?? null,
  amount: input.amount,
  status: input.status,
  receptionDate: input.receptionDate ?? new Date(),
  emailReceptionDate: input.emailReceptionDate ?? null,
  assignedUserId: input.assignedUserId,
  extraColumns: invoiceExtensionFor(appModule.applicationCode)?.create?.extraColumns(input) ?? {},
});

/** <app>.usp_invoice_create_batch enforces duplicate ids, existing ids, the daily limit and the app's rules atomically. */
export const createInvoices = (appModule: AppModule, inputs: CreateInvoiceInput[], userId: number) =>
  insertInvoices(appModule, inputs.map((i) => toNewInvoice(appModule, i)), userId);

// ---- Invoice Details

/** Status code as stored (the function matches codes case-insensitively). */
export const changeInvoiceStatus = async (appSchema: AppSchema, invoiceCode: string, status: string) => {
  await updateInvoiceStatus(appSchema, invoiceCode, status);
  const updated = await getInvoiceDetail(appSchema, invoiceCode);
  return updated?.invoice.status ?? status;
};

/** Common Super User fields plus every app's optional section (e.g. sjoFields). */
export const invoiceDetailsSchema = () =>
  invoiceDetailsBody.extend(
    Object.fromEntries(
      invoiceExtensions()
        .filter((e) => e.detailsSection)
        .map((e) => [e.detailsSection!.key, e.detailsSection!.schema.optional()]),
    ),
  );

/**
 * Invoice Details "Save": an app section is only accepted on that app's invoices; app sections are
 * saved first (their validation fails before anything is written), then the common fields.
 */
export const saveInvoiceDetails = async (appModule: AppModule, invoiceCode: string, userId: number, body: Record<string, unknown>) => {
  const { processId, originCityId, destinationCityId, claimNumber, additionalInfo, assignedUserId, ...sections } =
    body as z.infer<typeof invoiceDetailsBody> & Record<string, unknown>;
  for (const ext of invoiceExtensions()) {
    const section = ext.detailsSection;
    if (!section || sections[section.key] === undefined) continue;
    if (ext.applicationCode.toUpperCase() !== appModule.applicationCode.toUpperCase()) {
      throw HttpError.badRequest(`${section.key} can only be saved on ${ext.applicationCode.toUpperCase()} invoices`);
    }
    await section.save(invoiceCode, userId, sections[section.key] as never);
  }
  await updateInvoiceDetails(appModule.appSchema, invoiceCode, userId, {
    processId, originCityId, destinationCityId, claimNumber, additionalInfo, assignedUserId,
  });
  return getAppInvoice(appModule, invoiceCode);
};

export const sendInvoiceToPreviousTeam = (appSchema: AppSchema, invoiceCode: string) => sendToPreviousTeam(appSchema, invoiceCode);

// ---- Attachments

/** Validates the PDF and stores it through the attachment storage service (S3 or local) as an attachment. */
export const uploadInvoicePdf = async (
  appSchema: AppSchema,
  invoiceCode: string,
  file: { fileName: string; title?: string; primary: boolean; content: unknown },
) => {
  const body = file.content;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw HttpError.badRequest('Send the PDF as the request body with Content-Type: application/pdf');
  }
  if (body.subarray(0, 5).toString('latin1') !== '%PDF-') throw HttpError.badRequest('The file is not a PDF');
  return attachmentStorage.store({
    appSchema,
    invoiceCode,
    fileName: path.basename(file.fileName),
    title: file.title || null,
    category: 'Uploaded Document',
    mimeType: 'application/pdf',
    isPrimary: file.primary,
    content: body,
  });
};
