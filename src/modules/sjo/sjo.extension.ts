import type { InvoiceAppExtension } from '../common/invoices/invoice-extensions.js';
import { mapSjoFieldsResult, type SjoFieldsResult } from './sjo-fields/sjo-fields.dal.js';
import { toSjoFields } from './sjo-fields/sjo-fields.mapper.js';
import { sjoCreateInvoiceSchema, sjoFieldsBody, type SjoCreateInvoiceInput } from './sjo-fields/sjo-fields.schemas.js';
import { saveInvoiceSjoFields, sjoCreateColumns } from './sjo-fields/sjo-fields.service.js';

const sjoFieldsOf = (data: Record<string, unknown>) => {
  const raw = data.sjo_fields as SjoFieldsResult | null | undefined;
  return { sjoFields: raw ? toSjoFields(mapSjoFieldsResult(raw)) : null };
};

/**
 * SJO Invoice Processing: Country, BU, ERP, ID Fiscal, A.B. Number / Name and the Flow Turn Down /
 * Critical Vendor / Urgent Invoice flags (sjoFields on list and detail, null for other apps),
 * SJO-specific Create Invoice rules and the Invoice Details "sjoFields" section.
 */
export const sjoInvoiceExtension: InvoiceAppExtension = {
  applicationCode: 'SJO',
  listFields: sjoFieldsOf,
  detailFields: sjoFieldsOf,
  create: {
    schema: sjoCreateInvoiceSchema,
    extraColumns: (input) => sjoCreateColumns(input as SjoCreateInvoiceInput),
  },
  detailsSection: {
    key: 'sjoFields',
    schema: sjoFieldsBody,
    save: saveInvoiceSjoFields,
  },
};
