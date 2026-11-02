import { pool } from './pool.js';

/**
 * Thin wrapper around the app.usp_* PostgreSQL functions (see database/postgres/procedures).
 * Arguments are passed with named notation (p_name => $n) so their order does not matter.
 * Each row has the shape of an app.udt_*_result type, with snake_case column names.
 */
const FUNCTION_NAME = /^usp_[a-z_]+$/;
const ARG_NAME = /^p_[a-z0-9_]+$/;

export const callFunction = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> => {
  if (!FUNCTION_NAME.test(name)) throw new Error(`Invalid function name: ${name}`);
  const keys = Object.keys(args);
  for (const key of keys) if (!ARG_NAME.test(key)) throw new Error(`Invalid argument name: ${key}`);

  const argList = keys.map((key, i) => `${key} => $${i + 1}`).join(', ');
  const result = await pool.query(`SELECT * FROM app.${name}(${argList})`, keys.map((k) => args[k]));
  return result.rows as T[];
};

/** For functions that return exactly one composite value (non-SETOF). */
export const callFunctionSingle = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> =>
  (await callFunction<T>(name, args))[0];

// ---- Paging columns present on every row of the *_list_result types ----

export interface PageColumns {
  total_items: number;
  total_pages: number;
  page: number;
  page_size: number;
}

/** No rows means no matches: the functions clamp the page, so that is page 1 of 1. */
export const toPageMeta = (first: PageColumns | undefined, pageSize: number) => ({
  totalItems: first?.total_items ?? 0,
  totalPages: first?.total_pages ?? 1,
  page: first?.page ?? 1,
  limit: first?.page_size ?? pageSize,
});

// ---- Request type app.udt_invoice_input (sent as a JSON array) ----

export interface InvoiceInputRow {
  invoiceCode: string;
  vendorName: string;
  cuit: string;
  countryStation: string | null;
  invoice1a: string | null;
  invoice2a: string | null;
  amount: number;
  status: string;
  receptionDate: Date;
  emailReceptionDate: Date | null;
}

/** Keys must match the columns of app.udt_invoice_input (jsonb_populate_recordset). */
export const udtInvoiceInput = (rows: InvoiceInputRow[]) =>
  JSON.stringify(
    rows.map((r, i) => ({
      row_no: i + 1,
      invoice_code: r.invoiceCode,
      vendor_name: r.vendorName,
      cuit: r.cuit,
      country_station: r.countryStation,
      invoice_1a: r.invoice1a,
      invoice_2a: r.invoice2a,
      amount: r.amount,
      status: r.status,
      reception_date: r.receptionDate.toISOString().slice(0, 10),
      email_reception_date: r.emailReceptionDate?.toISOString() ?? null,
    })),
  );
