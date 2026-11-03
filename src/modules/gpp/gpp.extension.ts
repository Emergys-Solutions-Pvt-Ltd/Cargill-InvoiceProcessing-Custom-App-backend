import type { InvoiceAppExtension } from '../common/invoices/invoice-extensions.js';
import { mapCcppResult, type CcppResult } from './ccpp/ccpp.dal.js';
import { toCcpp } from './ccpp/ccpp.mapper.js';
import { mapSfFieldsResult, type SfFieldsResult } from './sf-fields/sf-fields.dal.js';
import { toSfFields } from './sf-fields/sf-fields.mapper.js';

/**
 * GPP (General Payments) fields on the common invoice detail: the CCPP rows (ccpps[], also the
 * "is CCPP Linked" flag) and the legacy Salesforce "GP Invoice" fields (sfFields, null until saved).
 * GPP uses the common Create Invoice rules (vendor, CUIT, amount required).
 */
export const gppInvoiceExtension: InvoiceAppExtension = {
  applicationCode: 'GP',
  detailFields: (data) => {
    const sf = data.sf_fields as SfFieldsResult | null | undefined;
    return {
      ccpps: ((data.ccpps as CcppResult[] | undefined) ?? []).map(mapCcppResult).map(toCcpp),
      sfFields: sf ? toSfFields(mapSfFieldsResult(sf)) : null,
    };
  },
};
