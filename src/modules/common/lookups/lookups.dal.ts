import { callFunctionSingle } from '../../../core/db/procedures.js';

// app.udt_lookups_result: jsonb arrays of udt_vendor_result / udt_lookup_value_result /
// udt_master_data_option_result (statuses)
interface LookupsResult {
  vendors: { id: string; legal_name: string; cuit: string }[];
  stations: { name: string; sort_order: number }[];
  teams: { name: string; sort_order: number }[];
  statuses: { id: string; code: string; name: string; color: string | null }[];
}

export const getLookups = async () => {
  const result = await callFunctionSingle<LookupsResult>('usp_lookup_get_all');
  return {
    vendors: result.vendors.map((v) => ({ name: v.legal_name, cuit: v.cuit })),
    stations: result.stations.map((s) => s.name),
    teams: result.teams.map((t) => t.name),
    // Active statuses in workflow order; code is what invoices store, color picks the pill style
    statuses: result.statuses.map((s) => ({ code: s.code, name: s.name, color: s.color ?? 'neutral' })),
  };
};
