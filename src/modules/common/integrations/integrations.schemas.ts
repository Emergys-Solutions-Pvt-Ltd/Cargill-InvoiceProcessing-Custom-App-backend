import { z } from 'zod';
import { paginationQuery } from '../../../core/http/pagination.js';

/**
 * Request shapes of /api/integrations. Provider-specific parts (connection, profile settings,
 * auth settings) are only checked for being objects here; the service validates them with the
 * provider's / auth strategy's own schemas so problems come back with precise field paths.
 */
const jsonObject = z.record(z.string(), z.unknown());
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const jobParams = idParam.extend({ jobId: z.coerce.number().int().positive() });
export const profileParams = idParam.extend({ profileId: z.coerce.number().int().positive() });

export const profileBody = z.object({
  id: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1, 'Name is required').max(100),
  moduleSlug: z.string().trim().min(1, 'Target application is required').max(100),
  isActive: z.boolean().default(true),
  settings: jsonObject.default({}),
  keyFields: z.array(z.string()).max(6).default([]),
  invoiceCodeTemplate: z.string().trim().min(1, 'Invoice id template is required').max(200),
  fieldMapping: jsonObject.default({}),
  cancellationRule: jsonObject.nullable().default(null),
  defaultStatus: z.string().trim().min(1).max(20).default('Pending'),
  initialFrom: z.coerce.date().nullable().optional(),
});

export const integrationBody = z.object({
  providerType: z.string().trim().min(1).max(50).default('sap-odata'),
  name: z.string().trim().min(1, 'Name is required').max(150),
  description: optionalText(1000),
  environment: optionalText(100),
  sourceSystem: z
    .string()
    .trim()
    .min(1, 'Source system is required')
    .max(100)
    .regex(/^[A-Za-z0-9_.:-]+$/, 'Letters, digits and . _ : - only (e.g. S4P-100)'),
  isActive: z.boolean().default(true),
  connection: jsonObject,
  authType: z.string().trim().min(1).max(50),
  authSettings: jsonObject.default({}),
  schedule: jsonObject.default({ mode: 'interval', intervalMinutes: 60, timezone: 'UTC' }),
  autoSyncEnabled: z.boolean().default(false),
  retryPolicy: jsonObject.default({}),
  profiles: z.array(profileBody).max(20).default([]),
  /** Optional on create: credentials stored together with the new integration. */
  secret: jsonObject.optional(),
});

export const updateBody = integrationBody.omit({ secret: true }).extend({ version: z.number().int().positive() });

export const credentialsBody = z.object({ secret: jsonObject });

export const testConnectionBody = z
  .object({
    /** Unsaved form values to test instead of the stored ones (secret optional: stored one is used). */
    draft: integrationBody.partial().optional(),
  })
  .default({});

export const listQuery = z.object({ providerType: z.string().trim().max(50).optional() });

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'] as const;

export const jobListQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  trigger: z.enum(['scheduled', 'manual', 'retry']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationQuery,
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const errorListQuery = z.object({
  stage: z.enum(['fetch', 'mapping', 'validation', 'persistence', 'review']).optional(),
  ...paginationQuery,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
