import type { IntegrationRecord, JobRecord, ProfileRecord } from '../sync/ports.js';

/**
 * snake_case rows of app.udt_integration_result / udt_sync_job_result -> records.
 * Typed columns arrive as Date (pg); values nested in jsonb columns arrive as ISO strings.
 */
type DbDate = Date | string | null;

export const toDate = (value: DbDate): Date | null => (value === null ? null : value instanceof Date ? value : new Date(value));

export interface IntegrationRow {
  id: string;
  provider_type: string;
  name: string;
  description: string | null;
  environment: string | null;
  source_system: string;
  is_active: boolean;
  connection: Record<string, unknown>;
  auth_type: string;
  auth_settings: Record<string, unknown>;
  secret_configured: boolean;
  secret_updated_at: DbDate;
  schedule: Record<string, unknown>;
  auto_sync_enabled: boolean;
  retry_policy: Record<string, unknown>;
  next_run_at: DbDate;
  last_attempt_at: DbDate;
  last_success_at: DbDate;
  last_status: string | null;
  last_job_id: string | null;
  version: number;
  profiles: ProfileRow[] | null;
  created_at: DbDate;
  updated_at: DbDate;
  updated_by_name: string | null;
}

export interface ProfileRow {
  id: string;
  integration_id: string;
  module_id: string;
  module_slug: string;
  module_name: string;
  application_code: string;
  invoice_prefix: string;
  name: string;
  is_active: boolean;
  settings: Record<string, unknown>;
  key_fields: unknown;
  invoice_code_template: string;
  field_mapping: Record<string, unknown>;
  cancellation_rule: Record<string, unknown> | null;
  default_status: string;
  initial_from: DbDate;
  watermark: DbDate;
  watermark_updated_at: DbDate;
  sort_order: number;
}

export const toProfileRecord = (r: ProfileRow): ProfileRecord => ({
  id: r.id,
  integrationId: r.integration_id,
  moduleId: r.module_id,
  moduleSlug: r.module_slug,
  moduleName: r.module_name,
  applicationCode: r.application_code,
  invoicePrefix: r.invoice_prefix,
  name: r.name,
  isActive: r.is_active,
  settings: r.settings ?? {},
  keyFields: r.key_fields ?? [],
  invoiceCodeTemplate: r.invoice_code_template,
  fieldMapping: r.field_mapping ?? {},
  cancellationRule: r.cancellation_rule,
  defaultStatus: r.default_status,
  initialFrom: toDate(r.initial_from),
  watermark: toDate(r.watermark),
  watermarkUpdatedAt: toDate(r.watermark_updated_at),
  sortOrder: r.sort_order,
});

export const toIntegrationRecord = (r: IntegrationRow): IntegrationRecord => ({
  id: r.id,
  providerType: r.provider_type,
  name: r.name,
  description: r.description,
  environment: r.environment,
  sourceSystem: r.source_system,
  isActive: r.is_active,
  connection: r.connection ?? {},
  authType: r.auth_type,
  authSettings: r.auth_settings ?? {},
  secretConfigured: r.secret_configured,
  secretUpdatedAt: toDate(r.secret_updated_at),
  schedule: r.schedule ?? {},
  autoSyncEnabled: r.auto_sync_enabled,
  retryPolicy: r.retry_policy ?? {},
  nextRunAt: toDate(r.next_run_at),
  lastAttemptAt: toDate(r.last_attempt_at),
  lastSuccessAt: toDate(r.last_success_at),
  lastStatus: r.last_status,
  lastJobId: r.last_job_id,
  version: r.version,
  profiles: (r.profiles ?? []).map(toProfileRecord),
  createdAt: toDate(r.created_at)!,
  updatedAt: toDate(r.updated_at)!,
  updatedByName: r.updated_by_name,
});

export interface JobRow {
  id: string;
  integration_id: string;
  integration_name: string;
  trigger_type: JobRecord['triggerType'];
  requested_by: string | null;
  requested_by_name: string | null;
  status: JobRecord['status'];
  attempt: number;
  max_attempts: number;
  retry_of_job_id: string | null;
  run_after: DbDate;
  started_at: DbDate;
  finished_at: DbDate;
  heartbeat_at: DbDate;
  worker_id: string | null;
  cancel_requested: boolean;
  records_fetched: number;
  records_created: number;
  records_updated: number;
  records_unchanged: number;
  records_rejected: number;
  records_failed: number;
  pages_processed: number;
  profile_stats: Record<string, unknown> | null;
  error_summary: string | null;
  error_count: number;
  duration_ms: number | null;
  created_at: DbDate;
}

export const toJobRecord = (r: JobRow): JobRecord => ({
  id: r.id,
  integrationId: r.integration_id,
  integrationName: r.integration_name,
  triggerType: r.trigger_type,
  requestedBy: r.requested_by,
  requestedByName: r.requested_by_name,
  status: r.status,
  attempt: r.attempt,
  maxAttempts: r.max_attempts,
  retryOfJobId: r.retry_of_job_id,
  runAfter: toDate(r.run_after)!,
  startedAt: toDate(r.started_at),
  finishedAt: toDate(r.finished_at),
  heartbeatAt: toDate(r.heartbeat_at),
  workerId: r.worker_id,
  cancelRequested: r.cancel_requested,
  recordsFetched: r.records_fetched,
  recordsCreated: r.records_created,
  recordsUpdated: r.records_updated,
  recordsUnchanged: r.records_unchanged,
  recordsRejected: r.records_rejected,
  recordsFailed: r.records_failed,
  pagesProcessed: r.pages_processed,
  profileStats: r.profile_stats ?? {},
  errorSummary: r.error_summary,
  errorCount: r.error_count,
  durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
  createdAt: toDate(r.created_at)!,
});
