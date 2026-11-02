import type { ProviderTemplate } from '../../core/contracts.js';

/**
 * Starting points for OnBase invoice imports. Document type and keyword names are site-specific:
 * "Test connection" resolves them and lists the keywords of a sample document, which is how the
 * mapping paths (keywords/<Keyword_Name>) are confirmed.
 */
const NOTES = [
  'Replace the document type / keyword names with the ones configured in your OnBase (system names or numeric ids).',
  'Keyword values are mapped as keywords/<Keyword_Name> (spaces and symbols become _). Test connection lists the keywords of a sample document.',
  'The OnBase document is attached to the invoice as its PDF (turn off "Attach document" to import data only).',
];

const mapping = {
  vendorName: { path: 'keywords/Vendor_Name', transform: 'string' as const },
  cuit: { path: 'keywords/CUIT', transform: 'cuit' as const },
  invoice1a: { path: 'keywords/Invoice_Number', transform: 'string' as const },
  invoiceDate: { path: 'keywords/Invoice_Date', transform: 'date' as const },
  receptionDate: { path: 'documentDate', transform: 'date' as const },
  currencyCode: { path: 'keywords/Currency', transform: 'upper' as const, constant: 'ARS' },
  amount: { path: 'keywords/Invoice_Amount', transform: 'number' as const },
};

const voided = { field: 'keywords/Invoice_Status', operator: 'in' as const, values: ['Void', 'Voided', 'Deleted'], setStatus: 'Rejected', onlyWhenStatusIn: ['Pending'] };

export const onbaseTemplates: ProviderTemplate[] = [
  {
    id: 'onbase-ap-invoice-gp',
    name: 'General Payments – OnBase AP invoices',
    description: 'Scanned / received AP invoices of the General Payments business.',
    applicationCode: 'GP',
    notes: [...NOTES, 'Restrict to General Payments with a keyword filter, e.g. Company Code or Business Unit.'],
    profile: {
      name: 'General Payments',
      settings: {
        documentTypes: ['AP - Invoice'],
        keywordFilters: [{ keyword: 'Company Code', operator: 'Equal', value: '1010' }],
        incremental: true,
        overlapDays: 1,
        lookbackDays: 30,
        windowDays: 7,
        pageSize: 50,
        attachDocuments: true,
      },
      keyFields: ['documentId'],
      invoiceCodeTemplate: 'INV-{prefix}-OB-{documentId}',
      fieldMapping: mapping,
      cancellationRule: voided,
      defaultStatus: 'Pending',
    },
  },
  {
    id: 'onbase-sjo-invoice',
    name: 'SJO – OnBase service job order invoices',
    description: 'Invoices for service job orders (SJO) captured in OnBase.',
    applicationCode: 'sjo',
    notes: [...NOTES, 'Use the document type (or a keyword such as Process = SJO) that identifies service job order invoices.'],
    profile: {
      name: 'SJO',
      settings: {
        documentTypes: ['AP - SJO Invoice'],
        keywordFilters: [],
        incremental: true,
        overlapDays: 1,
        lookbackDays: 30,
        windowDays: 7,
        pageSize: 50,
        attachDocuments: true,
      },
      keyFields: ['documentId'],
      invoiceCodeTemplate: 'INV-{prefix}-OB-{documentId}',
      fieldMapping: mapping,
      cancellationRule: voided,
      defaultStatus: 'Pending',
    },
  },
];
