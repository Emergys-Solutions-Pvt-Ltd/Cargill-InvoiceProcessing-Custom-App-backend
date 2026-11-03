import type { InvoiceAppExtension } from '../common/invoices/invoice-extensions.js';

/**
 * ROSPBU Invoice Processing. No ROSPBU-specific fields yet: it uses the common invoice model and
 * Create Invoice rules. Add its list / detail fields, create schema or Invoice Details section here
 * (with tables / functions under database/postgres/rospbu) when ROSPBU gets its own fields.
 */
export const rospbuInvoiceExtension: InvoiceAppExtension = {
  applicationCode: 'ROSPBU',
};
