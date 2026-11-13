import { callFunctionSingle, toDate, type DbDate } from '../../../core/db/procedures.js';
import type { SjoFieldsInput, SjoFieldsRow } from './sjo-fields.models.js';

// ---- Data access: sjo.udt_invoice_sjo_fields_result (sjo_fields column of usp_invoice_list /
// usp_invoice_get_by_code) and sjo.usp_invoice_sjo_fields_save ----

// sjo.udt_invoice_sjo_fields_result (NULL for non-SJO invoices)
export interface SjoFieldsResult {
  country_id: string;
  country_code: string;
  country_name: string;
  business_unit_id: string;
  business_unit_code: string;
  business_unit_name: string;
  erp_system_id: string;
  erp_system_code: string;
  erp_system_name: string;
  id_fiscal: string;
  ab_number: string | null;
  ab_name: string | null;
  flow_turn_down: boolean;
  critical_vendor: boolean;
  urgent_invoice: boolean;
  updated_at: DbDate | null;
}

export const mapSjoFieldsResult = (r: SjoFieldsResult): SjoFieldsRow => ({
  country: { id: r.country_id, code: r.country_code, name: r.country_name },
  businessUnit: { id: r.business_unit_id, code: r.business_unit_code, name: r.business_unit_name },
  erpSystem: { id: r.erp_system_id, code: r.erp_system_code, name: r.erp_system_name },
  idFiscal: r.id_fiscal,
  abNumber: r.ab_number,
  abName: r.ab_name,
  flowTurnDown: r.flow_turn_down,
  criticalVendor: r.critical_vendor,
  urgentInvoice: r.urgent_invoice,
  updatedAt: toDate(r.updated_at),
});

/** Invoice Details "Save" of the SJO fields (insert or update). Raises CA400 (not SJO, missing / inactive value), CA404. */
export const saveSjoFields = async (code: string, userId: string, input: SjoFieldsInput) => {
  await callFunctionSingle('sjo.usp_invoice_sjo_fields_save', {
    p_invoice_code: code,
    p_updated_by: userId,
    p_country_id: input.countryId,
    p_business_unit_id: input.businessUnitId,
    p_erp_system_id: input.erpSystemId,
    p_id_fiscal: input.idFiscal,
    p_ab_number: input.abNumber,
    p_ab_name: input.abName,
    p_flow_turn_down: input.flowTurnDown,
    p_critical_vendor: input.criticalVendor,
    p_urgent_invoice: input.urgentInvoice,
  });
};
