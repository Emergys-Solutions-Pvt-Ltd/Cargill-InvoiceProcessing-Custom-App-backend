import { getLookups } from './lookups.dal.js';

// ---- Business rules of the invoice dropdown sources (vendors, stations, statuses, teams) ----

/** Active statuses come in workflow order; vendors / stations / teams sorted by the function. */
export const getInvoiceLookups = () => getLookups();
