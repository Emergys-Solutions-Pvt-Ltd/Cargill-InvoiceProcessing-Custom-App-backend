import { HttpError } from '../../../core/http/http-error.js';
import { listCcpps, saveCcpp } from './ccpp.dal.js';
import type { CcppInput, CcppRow } from './ccpp.models.js';

// ---- Business rules of the GPP CCPP tab (the caller has already checked access to the invoice) ----

export const listInvoiceCcpps = (invoiceCode: string): Promise<CcppRow[]> => listCcpps(invoiceCode);

/** One CCPP row of the invoice; 404 when it belongs to another invoice or does not exist. */
export const getInvoiceCcpp = async (invoiceCode: string, ccppId: number): Promise<CcppRow> => {
  const ccpp = (await listCcpps(invoiceCode)).find((c) => c.id === ccppId);
  if (!ccpp) throw HttpError.notFound(`CCPP row '${ccppId}' not found on this invoice`);
  return ccpp;
};

export const addInvoiceCcpp = (invoiceCode: string, userId: number, input: CcppInput) => saveCcpp(invoiceCode, userId, input);

export const updateInvoiceCcpp = (invoiceCode: string, userId: number, ccppId: number, input: CcppInput) =>
  saveCcpp(invoiceCode, userId, input, ccppId);
