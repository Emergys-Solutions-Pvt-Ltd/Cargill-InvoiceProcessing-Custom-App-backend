import type { SjoFieldsRow } from './sjo-fields.models.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** SJO Invoice Processing fields (null for other apps); country / BU / ERP as { id, code, name }. */
export const toSjoFields = (f: SjoFieldsRow) => ({
  country: f.country,
  businessUnit: f.businessUnit,
  erpSystem: f.erpSystem,
  idFiscal: f.idFiscal,
  abNumber: f.abNumber,
  abName: f.abName,
  flowTurnDown: f.flowTurnDown,
  criticalVendor: f.criticalVendor,
  urgentInvoice: f.urgentInvoice,
  updatedAt: iso(f.updatedAt),
});
