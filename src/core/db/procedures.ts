import { pool } from './pool.js';

/**
 * Thin wrapper around the usp_* PostgreSQL functions (see database/postgres/<module>/procedures).
 * name: 'usp_x' (schema app, the common module) or '<schema>.usp_x' for a module schema
 * (app_auth, gpp, sjo, rospbu). Arguments are passed with named notation (p_name => $n) so their order
 * does not matter. Each row has the shape of a udt_*_result type, with snake_case column names.
 */
const FUNCTION_NAME = /^(?:(app|app_auth|gpp|sjo|rospbu)\.)?usp_[a-z_]+$/;
const ARG_NAME = /^p_[a-z0-9_]+$/;

export const callFunction = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> => {
  if (!FUNCTION_NAME.test(name)) throw new Error(`Invalid function name: ${name}`);
  const keys = Object.keys(args);
  for (const key of keys) if (!ARG_NAME.test(key)) throw new Error(`Invalid argument name: ${key}`);

  const argList = keys.map((key, i) => `${key} => $${i + 1}`).join(', ');
  const qualified = name.includes('.') ? name : `app.${name}`;
  const result = await pool.query(`SELECT * FROM ${qualified}(${argList})`, keys.map((k) => args[k]));
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

// ---- Dates ----

/**
 * Typed columns arrive as Date (see pool.ts); values nested in jsonb columns (e.g. the invoice
 * list / detail results) arrive as ISO strings.
 */
export type DbDate = Date | string;

export const toDate = (value: DbDate | null): Date | null => {
  if (value === null || value instanceof Date) return value;
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
};
