/**
 * OData query construction for SAP Gateway / S/4HANA services, V2 and V4:
 *   $filter literals per version and type (with quote escaping), structured filters,
 *   incremental filter, stable $orderby for paging, and URL encoding with %20 (SAP Gateway does
 *   not decode "+" as a space) while keeping "$" readable.
 */
export type ODataVersion = 'v2' | 'v4';
export type FilterValueType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'datetimeoffset' | 'guid';
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'in' | 'startswith';
export type IncrementalFieldType = 'DateTimeOffset' | 'DateTime' | 'Date' | 'TimestampDecimal';

export interface StructuredFilter {
  field: string;
  operator: FilterOperator;
  type: FilterValueType;
  values: string[];
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const isoNoMillis = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const localIso = (d: Date) => isoNoMillis(d).replace(/Z$/, ''); // Edm.DateTime: no zone, UTC wall clock

/** SAP "TimeStamp" decimals: yyyymmddhhmmss (UTC). */
export const toSapTimestamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

export const parseSapTimestamp = (value: unknown): Date | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?$/.exec(String(value ?? '').trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
};

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const formatLiteral = (value: string, type: FilterValueType, version: ODataVersion): string => {
  const v = value.trim();
  switch (type) {
    case 'string':
      return quote(value);
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`"${value}" is not a number`);
      return v;
    case 'boolean':
      if (!/^(true|false)$/i.test(v)) throw new Error(`"${value}" is not true/false`);
      return v.toLowerCase();
    case 'guid':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new Error(`"${value}" is not a GUID`);
      return version === 'v2' ? `guid'${v}'` : v;
    case 'date':
    case 'datetime':
    case 'datetimeoffset': {
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
      if (Number.isNaN(d.getTime())) throw new Error(`"${value}" is not a date`);
      if (version === 'v4') return type === 'date' ? d.toISOString().slice(0, 10) : isoNoMillis(d);
      return type === 'datetimeoffset' ? `datetimeoffset'${isoNoMillis(d)}'` : `datetime'${localIso(d)}'`;
    }
  }
};

const FIELD = /^[A-Za-z_][A-Za-z0-9_/]*$/;

export const buildStructuredFilter = (f: StructuredFilter, version: ODataVersion): string => {
  if (!FIELD.test(f.field)) throw new Error(`Invalid field name "${f.field}"`);
  if (f.values.length === 0) throw new Error(`Filter on ${f.field} needs a value`);
  const lit = (v: string) => formatLiteral(v, f.type, version);
  switch (f.operator) {
    case 'in':
      return `(${f.values.map((v) => `${f.field} eq ${lit(v)}`).join(' or ')})`;
    case 'startswith':
      return version === 'v2' ? `startswith(${f.field},${quote(f.values[0])}) eq true` : `startswith(${f.field},${quote(f.values[0])})`;
    default:
      return `${f.field} ${f.operator} ${lit(f.values[0])}`;
  }
};

export const incrementalLiteral = (since: Date, type: IncrementalFieldType, version: ODataVersion): string => {
  switch (type) {
    case 'DateTimeOffset':
      return version === 'v2' ? `datetimeoffset'${isoNoMillis(since)}'` : isoNoMillis(since);
    case 'DateTime':
      return version === 'v2' ? `datetime'${localIso(since)}'` : isoNoMillis(since);
    case 'Date':
      return version === 'v2' ? `datetime'${since.toISOString().slice(0, 10)}T00:00:00'` : since.toISOString().slice(0, 10);
    case 'TimestampDecimal':
      return toSapTimestamp(since);
  }
};

export interface QueryParts {
  select?: string;
  expand?: string;
  filters: string[];
  orderBy?: string;
  top?: number;
  skip?: number;
  extra?: Record<string, string>;
}

/** Combines filter expressions with "and", each wrapped in parentheses. */
export const combineFilters = (filters: string[]) =>
  filters.map((f) => f.trim()).filter(Boolean).map((f) => `(${f})`).join(' and ');

const encode = (value: string) => encodeURIComponent(value).replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%2F/gi, '/');

export const buildQueryString = (parts: QueryParts, version: ODataVersion): string => {
  const params: [string, string][] = [];
  if (parts.select) params.push(['$select', parts.select.replace(/\s+/g, '')]);
  if (parts.expand) params.push(['$expand', parts.expand.replace(/\s+/g, '')]);
  const filter = combineFilters(parts.filters);
  if (filter) params.push(['$filter', filter]);
  if (parts.orderBy) params.push(['$orderby', parts.orderBy]);
  if (parts.top !== undefined) params.push(['$top', String(parts.top)]);
  if (parts.skip) params.push(['$skip', String(parts.skip)]);
  if (version === 'v2') params.push(['$format', 'json']);
  for (const [k, v] of Object.entries(parts.extra ?? {})) params.push([k, v]);
  return params.map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
};
