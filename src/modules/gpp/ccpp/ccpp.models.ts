// GPP: CCPP rows of an invoice (gpp.invoice_ccpps)

/**
 * CCPP tab (gpp.invoice_ccpps) - the original 9 columns plus the legacy Salesforce "GP CCPP"
 * fields (52 of the 55 export fields; Link Invoice / Link Invoice CUIT / Linked Invoice Name are
 * not stored, see the table's UPGRADES comment). Element of both InvoiceDetail.ccpps and the
 * standalone /invoices/:invoiceId/ccpp CRUD routes.
 */
export interface CcppRow {
  id: number;
  invoiceId: number;
  product: string;
  legalDocIssuer: string | null;
  status: string;
  value: number | null;
  km: number | null;
  tons: number | null;
  unitRate: number | null;
  kmFc: number | null;
  tonsFc: number | null;
  thirdJurisdiction: string | null;
  ab: string | null;
  aux: string | null;
  bp: string | null;
  closedQuantity: number | null;
  pendingQuantity: number | null;
  totalQuantity: number | null;
  cc: string | null;
  cia: string | null;
  withholdingCode: string | null;
  withholdingConcept: string | null;
  matching: string | null;
  createdBy: number | null;
  createdByName: string | null;
  account: string | null;
  cuit: string | null;
  lineDescription: string | null;
  receiptDetail: string | null;
  status1: string | null;
  status2: string | null;
  receiptDate: string | null;
  gcia: string | null;
  name: string | null;
  iibbDestination: string | null;
  iibbOrigin: string | null;
  closedAmount: string | null;
  lineAmount: number | null;
  matchedAmount: string | null;
  pendingAmount: number | null;
  orderTotalAmount: number | null;
  vat: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  line: number | null;
  currency: string | null;
  municipality: string | null;
  orderNumber: string | null;
  receiptNumber: string | null;
  observation: string | null;
  originDestinationDrei: string | null;
  ownerLegacyId: string | null;
  praclo: string | null;
  praptd: string | null;
  prdgl: string | null;
  province: string | null;
  pruorg: string | null;
  suss: string | null;
  taxArea: string | null;
  orderType: string | null;
  receiptType: string | null;
  takeLine: string | null;
  uniqueCcpp: string | null;
  userLegacyId: string | null;
  fiscalZone: string | null;
}

export interface CcppInput {
  product: string;
  status: string;
  legalDocIssuer: string | null;
  value: number | null;
  km: number | null;
  tons: number | null;
  unitRate: number | null;
  kmFc: number | null;
  tonsFc: number | null;
  thirdJurisdiction: string | null;
  ab: string | null;
  aux: string | null;
  bp: string | null;
  closedQuantity: number | null;
  pendingQuantity: number | null;
  totalQuantity: number | null;
  cc: string | null;
  cia: string | null;
  withholdingCode: string | null;
  withholdingConcept: string | null;
  matching: string | null;
  account: string | null;
  cuit: string | null;
  lineDescription: string | null;
  receiptDetail: string | null;
  status1: string | null;
  status2: string | null;
  receiptDate: string | null;
  gcia: string | null;
  name: string | null;
  iibbDestination: string | null;
  iibbOrigin: string | null;
  closedAmount: string | null;
  lineAmount: number | null;
  matchedAmount: string | null;
  pendingAmount: number | null;
  orderTotalAmount: number | null;
  vat: string | null;
  line: number | null;
  currency: string | null;
  municipality: string | null;
  orderNumber: string | null;
  receiptNumber: string | null;
  observation: string | null;
  originDestinationDrei: string | null;
  ownerLegacyId: string | null;
  praclo: string | null;
  praptd: string | null;
  prdgl: string | null;
  province: string | null;
  pruorg: string | null;
  suss: string | null;
  taxArea: string | null;
  orderType: string | null;
  receiptType: string | null;
  takeLine: string | null;
  uniqueCcpp: string | null;
  userLegacyId: string | null;
  fiscalZone: string | null;
}
