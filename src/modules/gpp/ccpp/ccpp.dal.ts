import { callFunction, callFunctionSingle } from '../../../core/db/procedures.js';
import type { CcppInput, CcppRow } from './ccpp.models.js';

// ---- Data access: gpp.usp_ccpp_list / usp_ccpp_save (result type gpp.udt_ccpp_result) ----

// gpp.udt_ccpp_result
export interface CcppResult {
  id: number;
  invoice_id: number;
  product: string;
  legal_doc_issuer: string | null;
  status: string;
  value: number | null;
  km: number | null;
  tons: number | null;
  unit_rate: number | null;
  km_fc: number | null;
  tons_fc: number | null;
  third_jurisdiction: string | null;
  ab: string | null;
  aux: string | null;
  bp: string | null;
  closed_quantity: number | null;
  pending_quantity: number | null;
  total_quantity: number | null;
  cc: string | null;
  cia: string | null;
  withholding_code: string | null;
  withholding_concept: string | null;
  matching: string | null;
  created_by: number | null;
  created_by_name: string | null;
  account: string | null;
  cuit: string | null;
  line_description: string | null;
  receipt_detail: string | null;
  status1: string | null;
  status2: string | null;
  receipt_date: string | null;
  gcia: string | null;
  name: string | null;
  iibb_destination: string | null;
  iibb_origin: string | null;
  closed_amount: string | null;
  line_amount: number | null;
  matched_amount: string | null;
  pending_amount: number | null;
  order_total_amount: number | null;
  vat: string | null;
  updated_by: number | null;
  updated_by_name: string | null;
  line: number | null;
  currency: string | null;
  municipality: string | null;
  order_number: string | null;
  receipt_number: string | null;
  observation: string | null;
  origin_destination_drei: string | null;
  owner_legacy_id: string | null;
  praclo: string | null;
  praptd: string | null;
  prdgl: string | null;
  province: string | null;
  pruorg: string | null;
  suss: string | null;
  tax_area: string | null;
  order_type: string | null;
  receipt_type: string | null;
  take_line: string | null;
  unique_ccpp: string | null;
  user_legacy_id: string | null;
  fiscal_zone: string | null;
}

export const mapCcppResult = (r: CcppResult): CcppRow => ({
  id: r.id,
  invoiceId: r.invoice_id,
  product: r.product,
  legalDocIssuer: r.legal_doc_issuer,
  status: r.status,
  value: r.value,
  km: r.km,
  tons: r.tons,
  unitRate: r.unit_rate,
  kmFc: r.km_fc,
  tonsFc: r.tons_fc,
  thirdJurisdiction: r.third_jurisdiction,
  ab: r.ab,
  aux: r.aux,
  bp: r.bp,
  closedQuantity: r.closed_quantity,
  pendingQuantity: r.pending_quantity,
  totalQuantity: r.total_quantity,
  cc: r.cc,
  cia: r.cia,
  withholdingCode: r.withholding_code,
  withholdingConcept: r.withholding_concept,
  matching: r.matching,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  account: r.account,
  cuit: r.cuit,
  lineDescription: r.line_description,
  receiptDetail: r.receipt_detail,
  status1: r.status1,
  status2: r.status2,
  receiptDate: r.receipt_date,
  gcia: r.gcia,
  name: r.name,
  iibbDestination: r.iibb_destination,
  iibbOrigin: r.iibb_origin,
  closedAmount: r.closed_amount,
  lineAmount: r.line_amount,
  matchedAmount: r.matched_amount,
  pendingAmount: r.pending_amount,
  orderTotalAmount: r.order_total_amount,
  vat: r.vat,
  updatedBy: r.updated_by,
  updatedByName: r.updated_by_name,
  line: r.line,
  currency: r.currency,
  municipality: r.municipality,
  orderNumber: r.order_number,
  receiptNumber: r.receipt_number,
  observation: r.observation,
  originDestinationDrei: r.origin_destination_drei,
  ownerLegacyId: r.owner_legacy_id,
  praclo: r.praclo,
  praptd: r.praptd,
  prdgl: r.prdgl,
  province: r.province,
  pruorg: r.pruorg,
  suss: r.suss,
  taxArea: r.tax_area,
  orderType: r.order_type,
  receiptType: r.receipt_type,
  takeLine: r.take_line,
  uniqueCcpp: r.unique_ccpp,
  userLegacyId: r.user_legacy_id,
  fiscalZone: r.fiscal_zone,
});

/** GP Invoice Detail "CCPP" tab: all CCPP rows for an invoice. Raises CA404 when the invoice does not exist. */
export const listCcpps = async (code: string): Promise<CcppRow[]> => {
  const rows = await callFunction<CcppResult>('gpp.usp_ccpp_list', { p_invoice_code: code });
  return rows.map(mapCcppResult);
};

/**
 * GP Invoice Detail "CCPP" tab: add (ccppId omitted/null) or update (ccppId given) one row.
 * Raises CA400 (missing product/status, unknown acting user), CA404 (invoice not found, or on
 * update, the CCPP row doesn't exist / belongs to another invoice).
 */
export const saveCcpp = async (code: string, userId: number, input: CcppInput, ccppId: number | null = null): Promise<CcppRow> =>
  mapCcppResult(
    await callFunctionSingle<CcppResult>('gpp.usp_ccpp_save', {
      p_invoice_code: code,
      p_user_id: userId,
      p_product: input.product,
      p_status: input.status,
      p_id: ccppId,
      p_legal_doc_issuer: input.legalDocIssuer,
      p_value: input.value,
      p_km: input.km,
      p_tons: input.tons,
      p_unit_rate: input.unitRate,
      p_km_fc: input.kmFc,
      p_tons_fc: input.tonsFc,
      p_third_jurisdiction: input.thirdJurisdiction,
      p_ab: input.ab,
      p_aux: input.aux,
      p_bp: input.bp,
      p_closed_quantity: input.closedQuantity,
      p_pending_quantity: input.pendingQuantity,
      p_total_quantity: input.totalQuantity,
      p_cc: input.cc,
      p_cia: input.cia,
      p_withholding_code: input.withholdingCode,
      p_withholding_concept: input.withholdingConcept,
      p_matching: input.matching,
      p_account: input.account,
      p_cuit: input.cuit,
      p_line_description: input.lineDescription,
      p_receipt_detail: input.receiptDetail,
      p_status1: input.status1,
      p_status2: input.status2,
      p_receipt_date: input.receiptDate,
      p_gcia: input.gcia,
      p_name: input.name,
      p_iibb_destination: input.iibbDestination,
      p_iibb_origin: input.iibbOrigin,
      p_closed_amount: input.closedAmount,
      p_line_amount: input.lineAmount,
      p_matched_amount: input.matchedAmount,
      p_pending_amount: input.pendingAmount,
      p_order_total_amount: input.orderTotalAmount,
      p_vat: input.vat,
      p_line: input.line,
      p_currency: input.currency,
      p_municipality: input.municipality,
      p_order_number: input.orderNumber,
      p_receipt_number: input.receiptNumber,
      p_observation: input.observation,
      p_origin_destination_drei: input.originDestinationDrei,
      p_owner_legacy_id: input.ownerLegacyId,
      p_praclo: input.praclo,
      p_praptd: input.praptd,
      p_prdgl: input.prdgl,
      p_province: input.province,
      p_pruorg: input.pruorg,
      p_suss: input.suss,
      p_tax_area: input.taxArea,
      p_order_type: input.orderType,
      p_receipt_type: input.receiptType,
      p_take_line: input.takeLine,
      p_unique_ccpp: input.uniqueCcpp,
      p_user_legacy_id: input.userLegacyId,
      p_fiscal_zone: input.fiscalZone,
    }),
  );
