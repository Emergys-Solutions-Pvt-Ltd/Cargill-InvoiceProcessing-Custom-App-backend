import { z } from 'zod';

/** Connection + extraction settings of the OnBase (Hyland REST API) provider. */

const stripSlash = (v: string) => v.replace(/\/+$/, '');

export const onbaseConnectionSchema = z.object({
  /** Hyland API Server root, e.g. https://onbase.example.com/apiserver */
  apiServerUrl: z
    .string({ message: 'API Server URL is required' })
    .trim()
    .url('Enter a valid URL, e.g. https://onbase.example.com/apiserver')
    .transform(stripSlash),
  /** Path of the OnBase core API below the API Server root. */
  coreApiPath: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9_./-]*$/, 'Must start with /, e.g. /onbase/core')
    .default('/onbase/core')
    .transform(stripSlash),
  timeoutMs: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  minRequestIntervalMs: z.coerce.number().int().min(0).max(60_000).default(0),
  /** maxResults of one document query; a date window returning this many is split. */
  maxResults: z.coerce.number().int().min(10).max(10_000).default(1_000),
  /** Parallel keyword requests per page (OnBase sessions / API Server load). */
  keywordConcurrency: z.coerce.number().int().min(1).max(8).default(4),
  maxDocumentMb: z.coerce.number().int().min(1).max(200).default(25),
});

export type OnBaseConnection = z.infer<typeof onbaseConnectionSchema>;

/** A document type or keyword type: numeric OnBase id or its system name. */
const typeRef = z.string().trim().min(1, 'Enter an id or system name').max(150);

export const KEYWORD_OPERATORS = ['Equal', 'NotEqual', 'LessThan', 'LessThanEqual', 'GreaterThan', 'GreaterThanEqual'] as const;

export const onbaseProfileSettingsSchema = z.object({
  documentTypes: z.array(typeRef).min(1, 'Add at least one document type').max(20),
  keywordFilters: z
    .array(
      z.object({
        keyword: typeRef,
        operator: z.enum(KEYWORD_OPERATORS).default('Equal'),
        value: z.string().trim().min(1, 'Enter a value').max(250),
      }),
    )
    .max(20)
    .default([]),
  /** Read by document date from the saved cursor (otherwise: the last `lookbackDays` every run). */
  incremental: z.boolean().default(true),
  overlapDays: z.coerce.number().int().min(0).max(30).default(1),
  /** First run without cursor / initial date, and every run of a non-incremental profile. */
  lookbackDays: z.coerce.number().int().min(1).max(3_650).default(30),
  /** Date window per query; windows that hit maxResults are split automatically. */
  windowDays: z.coerce.number().int().min(1).max(366).default(7),
  /** Documents persisted per batch (keywords are read per document). */
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  attachDocuments: z.boolean().default(true),
});

export type OnBaseProfileSettings = z.infer<typeof onbaseProfileSettingsSchema>;

/** "Invoice Number" -> "Invoice_Number": keyword names as field-mapping paths (keywords/Invoice_Number). */
export const keywordKey = (name: string) => name.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Keyword';
