// SJO Invoice Processing fields (sjo.invoice_sjo_fields)

export interface LookupRef {
  id: string;
  code: string;
  name: string;
}

export interface SjoFieldsRow {
  country: LookupRef;
  businessUnit: LookupRef;
  erpSystem: LookupRef;
  idFiscal: string;
  abNumber: string | null;
  abName: string | null;
  flowTurnDown: boolean;
  criticalVendor: boolean;
  urgentInvoice: boolean;
  updatedAt: Date | null;
}

export interface SjoFieldsInput {
  countryId: string;
  businessUnitId: string;
  erpSystemId: string;
  idFiscal: string;
  abNumber: string | null;
  abName: string | null;
  flowTurnDown: boolean;
  criticalVendor: boolean;
  urgentInvoice: boolean;
}
