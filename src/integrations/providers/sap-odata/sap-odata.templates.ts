import type { ProviderTemplate } from '../../core/contracts.js';

/**
 * Starting points for the extraction profiles, based on the S/4HANA Supplier Invoice API
 * (OData V2 service API_SUPPLIERINVOICE_PROCESS_SRV, entity set A_SupplierInvoice).
 * Property names differ between releases and customer extensions: "Test connection" checks every
 * referenced field against the service $metadata and lists the ones to adjust.
 */
const COMMON_NOTES = [
  'Confirm property names against your service: Test connection lists fields that do not exist.',
  'Vendor name and CUIT are supplier master data: A_SupplierInvoice only carries the supplier number (InvoicingParty). Expose name and tax number through a custom CDS view (as mapped here: InvoicingPartyName, TaxNumber1) or an $expand to the supplier (e.g. to_Supplier/SupplierName, to_Supplier/TaxNumber1).',
  'Incremental sync needs a change timestamp. Without one, PostingDate with a 1-day overlap is used; set a LastChangeDateTime-type field if your service offers it.',
];

const baseMapping = {
  vendorName: { path: 'InvoicingPartyName', transform: 'string' as const },
  cuit: { path: 'TaxNumber1', transform: 'cuit' as const },
  invoice1a: { path: 'SupplierInvoiceIDByInvcgParty', transform: 'string' as const },
  invoiceDate: { path: 'DocumentDate', transform: 'date' as const },
  receptionDate: { path: 'PostingDate', transform: 'date' as const },
  currencyCode: { path: 'DocumentCurrency', transform: 'upper' as const },
  amount: { path: 'InvoiceGrossAmount', transform: 'number' as const },
};

const reversal = {
  field: 'ReverseDocument',
  operator: 'notEmpty' as const,
  values: [],
  setStatus: 'Rejected',
  onlyWhenStatusIn: ['Pending'],
};

export const sapTemplates: ProviderTemplate[] = [
  {
    id: 'sap-supplier-invoice-gp',
    name: 'General Payments – Supplier invoices',
    description: 'Posted supplier invoices of the General Payments company codes.',
    applicationCode: 'GP',
    notes: [...COMMON_NOTES, 'Set the company codes (and document types) that belong to General Payments in the filters.'],
    profile: {
      name: 'General Payments',
      settings: {
        entitySet: 'A_SupplierInvoice',
        select: '',
        expand: '',
        filters: [
          { field: 'CompanyCode', operator: 'in', type: 'string', values: ['1010'] },
          { field: 'SupplierInvoiceStatus', operator: 'eq', type: 'string', values: ['5'] },
        ],
        customFilter: '',
        orderBy: '',
        incrementalField: 'PostingDate',
        incrementalFieldType: 'DateTime',
        overlapMinutes: 1440,
      },
      keyFields: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'],
      invoiceCodeTemplate: 'INV-{prefix}-SAP-{SupplierInvoice}-{FiscalYear}',
      fieldMapping: baseMapping,
      cancellationRule: reversal,
      defaultStatus: 'Pending',
    },
  },
  {
    id: 'sap-supplier-invoice-sjo',
    name: 'SJO – Service job order invoices',
    description: 'Supplier invoices for service job orders (SJO), selected by document type / company code.',
    applicationCode: 'sjo',
    notes: [...COMMON_NOTES, 'Set the document type(s) used for service job orders in the filters (e.g. a dedicated RE document type).'],
    profile: {
      name: 'SJO',
      settings: {
        entitySet: 'A_SupplierInvoice',
        select: '',
        expand: '',
        filters: [
          { field: 'CompanyCode', operator: 'in', type: 'string', values: ['1010'] },
          { field: 'AccountingDocumentType', operator: 'eq', type: 'string', values: ['RE'] },
        ],
        customFilter: '',
        orderBy: '',
        incrementalField: 'PostingDate',
        incrementalFieldType: 'DateTime',
        overlapMinutes: 1440,
      },
      keyFields: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'],
      invoiceCodeTemplate: 'INV-{prefix}-SAP-{SupplierInvoice}-{FiscalYear}',
      fieldMapping: baseMapping,
      cancellationRule: reversal,
      defaultStatus: 'Pending',
    },
  },
];
