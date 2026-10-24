import crypto from 'node:crypto';
import { z } from 'zod';
import type { ProfileConfig, SourceRecord } from '../contracts.js';

/**
 * Converts provider records into the application's canonical invoice (the shape persisted by
 * app.usp_sync_page_apply), driven entirely by the profile's field mapping - no provider code.
 */

// ---------------------------------------------------------------- canonical invoice

export const CANONICAL_FIELDS = [
  { name: 'vendorName', label: 'Vendor name', type: 'string', required: true },
  { name: 'cuit', label: 'Vendor CUIT (tax id)', type: 'cuit', required: true },
  { name: 'invoice1a', label: '1a Invoice (supplier invoice number)', type: 'string', required: false },
  { name: 'invoice2a', label: '2a Invoice', type: 'string', required: false },
  { name: 'firstInvoiceNumber', label: '1° Invoice number (point of sale)', type: 'string', required: false },
  { name: 'secondInvoiceNumber', label: '2° Invoice number', type: 'string', required: false },
  { name: 'invoiceDate', label: 'Invoice date', type: 'date', required: false },
  { name: 'receptionDate', label: 'Reception date', type: 'date', required: true },
  { name: 'currencyCode', label: 'Currency', type: 'string', required: false },
  { name: 'amount', label: 'Amount', type: 'number', required: true },
  { name: 'invoiceSubtotal', label: 'Subtotal', type: 'number', required: false },
  { name: 'invoiceSubtotalWithTax', label: 'Subtotal with tax', type: 'number', required: false },
  { name: 'creditNote', label: 'Credit note', type: 'boolean', required: false },
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number]['name'];
const CANONICAL_NAMES = CANONICAL_FIELDS.map((f) => f.name) as [CanonicalField, ...CanonicalField[]];
export const REQUIRED_FIELDS = CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.name);

export interface CanonicalInvoice {
  externalKey: string;
  externalDoc: Record<string, string>;
  invoiceCode: string;
  vendorName: string;
  cuit: string;
  invoice1a: string | null;
  invoice2a: string | null;
  firstInvoiceNumber: string | null;
  secondInvoiceNumber: string | null;
  invoiceDate: string | null;
  receptionDate: string;
  currencyCode: string | null;
  amount: number;
  invoiceSubtotal: number | null;
  invoiceSubtotalWithTax: number | null;
  creditNote: boolean;
  sourceChangedAt: string | null;
  cancelled: boolean;
}

// ---------------------------------------------------------------- mapping configuration

export const TRANSFORMS = ['string', 'upper', 'number', 'abs', 'date', 'datetime', 'boolean', 'cuit'] as const;
export type TransformName = (typeof TRANSFORMS)[number];

const sourcePath = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_./-]+$/, 'Use property names separated by / or .');

export const fieldRuleSchema = z
  .object({
    path: sourcePath.optional(),
    constant: z.union([z.string().max(255), z.number(), z.boolean()]).optional(),
    transform: z.enum(TRANSFORMS).optional(),
  })
  .refine((r) => r.path !== undefined || r.constant !== undefined, 'Set a source field or a constant');

export const fieldMappingSchema = z
  .partialRecord(z.enum(CANONICAL_NAMES), fieldRuleSchema)
  .superRefine((mapping, ctx) => {
    for (const field of REQUIRED_FIELDS) {
      if (!mapping[field]) ctx.addIssue({ code: 'custom', path: [field], message: `${field} must be mapped` });
    }
  });

export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type FieldMapping = Partial<Record<CanonicalField, FieldRule>>;

export const cancellationRuleSchema = z
  .object({
    field: sourcePath,
    operator: z.enum(['notEmpty', 'equals', 'notEquals', 'in', 'isTrue']),
    values: z.array(z.string().max(100)).max(50).default([]),
    setStatus: z.string().trim().min(1).max(20).default('Rejected'),
    onlyWhenStatusIn: z.array(z.string().trim().min(1).max(20)).min(1).max(20).default(['Pending']),
  })
  .refine((r) => !['equals', 'notEquals', 'in'].includes(r.operator) || r.values.length > 0, {
    message: 'Enter at least one value for this operator',
    path: ['values'],
  });

export type CancellationRule = z.infer<typeof cancellationRuleSchema>;

export const keyFieldsSchema = z.array(sourcePath).min(1, 'At least one key field is required').max(6);

export const INVOICE_CODE_MAX = 60;
export const invoiceCodeTemplateSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((t) => /\{[^}]+\}/.test(t), 'The template must contain at least one {field} placeholder');

// ---------------------------------------------------------------- value access + transforms

/** Reads 'a/b/c' or 'a.b.c' from nested objects (OData $expand results included). */
export const getPath = (record: unknown, path: string): unknown => {
  let current: unknown = record;
  for (const part of path.split(/[/.]/)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** OData V2 '/Date(1719792000000)/' or '/Date(1719792000000+0000)/', ISO strings, 'YYYYMMDD', Date. */
export const parseSourceDate = (value: unknown): Date | null => {
  if (isBlank(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value).trim();
  const v2 = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(text);
  if (v2) return new Date(Number(v2[1]));
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3])));
  // Date-only and zone-less timestamps are UTC wall clock (SAP Edm.DateTime has no zone)
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text) ? `${text}Z` : text;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toCuit = (value: unknown) => {
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : String(value).trim();
};

export const applyTransform = (value: unknown, transform: TransformName): unknown => {
  if (isBlank(value)) return null;
  switch (transform) {
    case 'string':
      return String(value).trim();
    case 'upper':
      return String(value).trim().toUpperCase();
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : Number.NaN;
    }
    case 'abs': {
      const n = Number(value);
      return Number.isFinite(n) ? Math.abs(n) : Number.NaN;
    }
    case 'date': {
      const d = parseSourceDate(value);
      return d ? d.toISOString().slice(0, 10) : 'invalid-date';
    }
    case 'datetime': {
      const d = parseSourceDate(value);
      return d ? d.toISOString() : 'invalid-date';
    }
    case 'boolean':
      return value === true || value === 1 || ['true', 'x', 'yes', '1'].includes(String(value).trim().toLowerCase());
    case 'cuit':
      return toCuit(value);
  }
};

const DEFAULT_TRANSFORM: Record<(typeof CANONICAL_FIELDS)[number]['type'], TransformName> = {
  string: 'string',
  number: 'number',
  date: 'date',
  boolean: 'boolean',
  cuit: 'cuit',
};

// ---------------------------------------------------------------- canonical validation

const optionalText = (max: number) => z.string().max(max, `must be at most ${max} characters`).nullable();
const money = z.number({ message: 'must be a number' }).finite('must be a number').min(0).max(9_999_999_999_999_999);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a valid date');

const canonicalSchema = z.object({
  externalKey: z.string().min(1).max(200),
  invoiceCode: z
    .string()
    .min(1)
    .max(INVOICE_CODE_MAX, `must be at most ${INVOICE_CODE_MAX} characters`)
    .regex(/^[A-Za-z0-9._/-]+$/, 'contains characters that are not allowed'),
  vendorName: z.string({ message: 'is required' }).trim().min(1, 'is required').max(255),
  cuit: z.string({ message: 'is required' }).regex(/^\d{2}-\d{8}-\d$/, 'must be an 11-digit CUIT'),
  invoice1a: optionalText(30),
  invoice2a: optionalText(30),
  firstInvoiceNumber: optionalText(20),
  secondInvoiceNumber: optionalText(20),
  invoiceDate: isoDate.nullable(),
  receptionDate: isoDate,
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO currency code').nullable(),
  amount: money,
  invoiceSubtotal: money.nullable(),
  invoiceSubtotalWithTax: money.nullable(),
  creditNote: z.boolean(),
});

// ---------------------------------------------------------------- mapper

export type MapResult =
  | { ok: true; invoice: CanonicalInvoice; payloadHash: string }
  | { ok: false; externalKey: string | null; stage: 'mapping' | 'validation'; message: string; details: Record<string, unknown> };

const sanitizeCodePart = (value: unknown) => String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '-');

export const renderInvoiceCode = (template: string, record: SourceRecord, prefix: string) =>
  template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    if (name === 'prefix') return prefix;
    const value = getPath(record, name);
    return isBlank(value) ? '' : sanitizeCodePart(value);
  });

export const evaluateCancellation = (rule: CancellationRule | null, record: SourceRecord) => {
  if (!rule) return false;
  const raw = getPath(record, rule.field);
  const text = isBlank(raw) ? '' : String(raw).trim();
  switch (rule.operator) {
    case 'notEmpty':
      return text !== '';
    case 'isTrue':
      return applyTransform(raw, 'boolean') === true;
    case 'equals':
      return rule.values.includes(text);
    case 'in':
      return rule.values.includes(text);
    case 'notEquals':
      return text !== '' && !rule.values.includes(text);
  }
};

/** Stable SHA-256 of the business content (sourceChangedAt excluded: a touch without changes is "unchanged"). */
export const payloadHash = (invoice: CanonicalInvoice) => {
  const { sourceChangedAt: _ignored, ...content } = invoice;
  const sorted = Object.fromEntries(Object.entries(content).sort(([a], [b]) => a.localeCompare(b)));
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
};

export const mapRecord = (record: SourceRecord, profile: ProfileConfig, changedAt: Date | null): MapResult => {
  // External key from the configured key fields
  const keyValues: Record<string, string> = {};
  const missingKeys: string[] = [];
  for (const field of profile.keyFields) {
    const value = getPath(record, field);
    if (isBlank(value)) missingKeys.push(field);
    else keyValues[field] = String(value).trim();
  }
  const partialKey = Object.values(keyValues).join('/') || null;
  if (missingKeys.length > 0) {
    return {
      ok: false, externalKey: partialKey, stage: 'mapping',
      message: `Missing key field(s): ${missingKeys.join(', ')}`,
      details: { missingKeyFields: missingKeys },
    };
  }
  const externalKey = profile.keyFields.map((f) => keyValues[f]).join('/');

  // Field mapping
  const values: Record<string, unknown> = {};
  for (const meta of CANONICAL_FIELDS) {
    const rule = profile.fieldMapping[meta.name];
    if (!rule) {
      values[meta.name] = null;
      continue;
    }
    const raw = rule.path !== undefined ? getPath(record, rule.path) : rule.constant;
    const effective = isBlank(raw) && rule.constant !== undefined ? rule.constant : raw;
    values[meta.name] = applyTransform(effective, rule.transform ?? DEFAULT_TRANSFORM[meta.type]);
  }

  // Credit notes: SAP amounts may come signed; store the absolute amount and flag the credit note
  if (typeof values.amount === 'number' && values.amount < 0) {
    values.amount = Math.abs(values.amount);
    values.creditNote = true;
  }
  values.creditNote = values.creditNote === true;

  const invoiceCode = renderInvoiceCode(profile.invoiceCodeTemplate, record, profile.invoicePrefix);
  const parsed = canonicalSchema.safeParse({ ...values, externalKey, invoiceCode });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'record');
      fieldErrors[field] ??= issue.message;
    }
    return {
      ok: false, externalKey, stage: 'validation',
      message: Object.entries(fieldErrors).map(([f, m]) => `${f}: ${m}`).join('; '),
      details: { fieldErrors },
    };
  }

  const invoice: CanonicalInvoice = {
    ...parsed.data,
    externalDoc: keyValues,
    sourceChangedAt: changedAt ? changedAt.toISOString() : null,
    cancelled: evaluateCancellation(profile.cancellationRule, record),
  };
  return { ok: true, invoice, payloadHash: payloadHash(invoice) };
};
