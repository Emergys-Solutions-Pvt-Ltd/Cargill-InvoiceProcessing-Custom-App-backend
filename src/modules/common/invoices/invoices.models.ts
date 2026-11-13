import type { AppSchema } from '../apps/apps.models.js';
import type { AttachmentRow } from '../attachments/attachments.models.js';

// Invoice models shared by GPP, SJO and ROSPBU: every app has its own tables with the same core
// columns (<app>.<app>_invoices + child tables), so one model fits all three.

/** Raw app-specific result columns (jsonb) keyed by column name. */
export type InvoiceExtensionData = Record<string, unknown>;

/** A code from app.statuses (Settings > Configuration > Statuses), e.g. 'Pending'. */
export type InvoiceStatus = string;

export interface InvoiceRow {
  /** App schema the invoice lives in (gpp, sjo, rospbu); invoice codes are unique per app. */
  appSchema: AppSchema;
  id: string;
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
  /** NULL when the app identifies the vendor another way (SJO: ID Fiscal / A.B. Number). */
  vendorName: string | null;
  cuit: string | null;
  countryStation: string | null;
  pdfAttachmentId: string | null;
  pdfFileName: string | null;
  pdfTitle: string | null;
  pdfMimeType: string | null;
  // Workflow / Super User fields (Invoice Details page)
  processId: string | null;
  processName: string | null;
  originCityId: string | null;
  originName: string | null;
  destinationCityId: string | null;
  destinationName: string | null;
  teamId: string | null;
  teamName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  claimNumber: number;
  additionalInfo: string | null;
  filenetId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  isManual: boolean;
  /**
   * App-specific columns returned with the invoice, as raw JSON by column name (e.g. sjo_fields on the
   * list; sf_fields, ccpps, sjo_fields on the detail). Read by the app modules' invoice extensions.
   */
  extensions: InvoiceExtensionData;
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

/** The email the invoice PDF was received through (app.invoice_source_emails). */
export interface SourceEmailRow {
  id: string;
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
  sourceEmail: SourceEmailRow | null;
}

export interface InvoiceListFilters {
  search: string;
  status: string;
  page: number;
  limit: number;
}

export interface InvoiceDetailsInput {
  processId: string | null;
  originCityId: string | null;
  destinationCityId: string | null;
  claimNumber: number;
  additionalInfo: string | null;
  assignedUserId: string | null;
}

/**
 * One invoice to create (Create Invoice / Bulk Upload), common columns of app.udt_invoice_input.
 * Vendor / CUIT / amount may be NULL only where the app's create rules allow it (SJO).
 * extraColumns: app-specific udt_invoice_input columns (snake_case), e.g. the SJO fields.
 */
export interface NewInvoice {
  invoiceCode: string;
  vendorName: string | null;
  cuit: string | null;
  countryStation: string | null;
  invoice1a: string | null;
  invoice2a: string | null;
  amount: number | null;
  status: InvoiceStatus;
  receptionDate: Date;
  emailReceptionDate: Date | null;
  assignedUserId: string | null;
  extraColumns: Record<string, unknown>;
}
