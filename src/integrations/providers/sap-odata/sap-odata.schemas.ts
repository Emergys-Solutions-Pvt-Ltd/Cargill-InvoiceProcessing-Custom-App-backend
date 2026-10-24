import { z } from 'zod';

/** Connection + extraction settings of the SAP OData provider (validated on save and before every run). */

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const PROPERTY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROPERTY_PATH = /^[A-Za-z_][A-Za-z0-9_/]*$/;
const PROPERTY_LIST = /^\s*[A-Za-z_][A-Za-z0-9_/]*(\s*,\s*[A-Za-z_][A-Za-z0-9_/]*)*\s*$/;
const ORDER_BY = /^\s*[A-Za-z_][A-Za-z0-9_/]*(\s+(asc|desc))?(\s*,\s*[A-Za-z_][A-Za-z0-9_/]*(\s+(asc|desc))?)*\s*$/i;

export const sapConnectionSchema = z.object({
  baseUrl: z.string({ message: 'Base URL is required' }).trim().url('Enter a valid URL, e.g. https://my-s4.example.com').transform((u) => u.replace(/\/+$/, '')),
  servicePath: z
    .string({ message: 'Service path is required' })
    .trim()
    .regex(/^\/[A-Za-z0-9_.;=/'(),-]*$/, 'Must start with / , e.g. /sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV')
    .transform((p) => p.replace(/\/+$/, '')),
  odataVersion: z.enum(['v2', 'v4']).default('v2'),
  apiVersion: z.string().trim().max(20).optional().default(''),
  sapClient: z.string().trim().regex(/^(\d{3})?$/, 'SAP client is 3 digits, e.g. 100').optional().default(''),
  language: z.string().trim().regex(/^([A-Za-z]{2})?$/, 'Two-letter language, e.g. EN').optional().default(''),
  timeoutMs: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  minRequestIntervalMs: z.coerce.number().int().min(0).max(60_000).default(0),
  defaultPageSize: z.coerce.number().int().min(1).max(5_000).default(500),
  /** Non-secret custom headers (secret headers belong to the API key auth method). */
  customHeaders: z
    .record(z.string().regex(HEADER_NAME, 'Invalid header name'), z.string().max(500))
    .default({})
    .refine((h) => !Object.keys(h).some((k) => /^(authorization|cookie|host|apikey|x-csrf-token)$/i.test(k)), {
      message: 'Credentials headers must be configured under Authentication',
    }),
});

export type SapConnection = z.infer<typeof sapConnectionSchema>;

export const structuredFilterSchema = z.object({
  field: z.string().trim().regex(PROPERTY_PATH, 'Invalid property name'),
  operator: z.enum(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'startswith']),
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'datetimeoffset', 'guid']).default('string'),
  values: z.array(z.string().max(200)).min(1, 'Enter a value').max(50),
});

export const sapProfileSettingsSchema = z
  .object({
    entitySet: z.string({ message: 'Entity set is required' }).trim().regex(PROPERTY, 'Entity set name, e.g. A_SupplierInvoice'),
    select: z.string().trim().max(2_000).refine((s) => s === '' || PROPERTY_LIST.test(s), 'Comma-separated property names').default(''),
    expand: z.string().trim().max(1_000).refine((s) => s === '' || PROPERTY_LIST.test(s), 'Comma-separated navigation properties').default(''),
    /** Structured filters (company code, document type, supplier, status, dates ...), combined with AND. */
    filters: z.array(structuredFilterSchema).max(30).default([]),
    /** Advanced: raw $filter expression added with AND. */
    customFilter: z.string().trim().max(4_000).refine((f) => !/[\r\n]/.test(f), 'Single line only').default(''),
    orderBy: z.string().trim().max(500).refine((s) => s === '' || ORDER_BY.test(s), 'e.g. PostingDate asc, SupplierInvoice asc').default(''),
    pageSize: z.coerce.number().int().min(1).max(5_000).optional(),
    incrementalField: z.string().trim().max(100).refine((s) => s === '' || PROPERTY.test(s), 'Property name').default(''),
    incrementalFieldType: z.enum(['DateTimeOffset', 'DateTime', 'Date', 'TimestampDecimal']).default('DateTimeOffset'),
    overlapMinutes: z.coerce.number().int().min(0).max(10_080).default(5),
    /** Bounds one run; the next run continues from the saved cursor (incremental profiles). */
    maxRecordsPerRun: z.coerce.number().int().min(1).max(1_000_000).optional(),
  });

export type SapProfileSettings = z.infer<typeof sapProfileSettingsSchema>;
