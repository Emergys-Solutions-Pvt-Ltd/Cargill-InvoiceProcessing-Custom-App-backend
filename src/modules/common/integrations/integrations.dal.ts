import { callFunction, callFunctionSingle, toPageMeta, type PageColumns } from '../../../core/db/procedures.js';
import {
  toIntegrationRecord,
  toJobRecord,
  type IntegrationRow,
  type JobRow,
} from './engine/persistence/row-mappers.js';
import type { IntegrationRecord, JobRecord } from './engine/sync/ports.js';
import { type IntegrationWrite, type SyncErrorRow, type IntegrationSummary, type JobListFilters } from './integrations.models.js';

/** Settings > SAP Configuration persistence (app.usp_integration_* / app.usp_sync_* functions). */

export const listIntegrations = async (providerType?: string): Promise<IntegrationRecord[]> =>
  (await callFunction<IntegrationRow>('usp_integration_list', { p_provider_type: providerType ?? null })).map(toIntegrationRecord);

export const getIntegration = async (id: number): Promise<IntegrationRecord | null> => {
  const [row] = await callFunction<IntegrationRow>('usp_integration_get', { p_integration_id: id });
  return row ? toIntegrationRecord(row) : null;
};

export const saveIntegration = async (w: IntegrationWrite, userId: number): Promise<IntegrationRecord> => {
  const profiles = w.profiles.map((p) => ({
    id: p.id,
    module_id: p.moduleId,
    name: p.name,
    is_active: p.isActive,
    settings: p.settings,
    key_fields: p.keyFields,
    invoice_code_template: p.invoiceCodeTemplate,
    field_mapping: p.fieldMapping,
    cancellation_rule: p.cancellationRule,
    default_status: p.defaultStatus,
    initial_from: p.initialFrom?.toISOString() ?? null,
    sort_order: p.sortOrder,
  }));
  const row = await callFunctionSingle<IntegrationRow>('usp_integration_save', {
    p_integration_id: w.id,
    p_expected_version: w.expectedVersion,
    p_provider_type: w.providerType,
    p_name: w.name,
    p_description: w.description,
    p_environment: w.environment,
    p_source_system: w.sourceSystem,
    p_is_active: w.isActive,
    p_connection: JSON.stringify(w.connection),
    p_auth_type: w.authType,
    p_auth_settings: JSON.stringify(w.authSettings),
    p_clear_secret: w.clearSecret,
    p_schedule: JSON.stringify(w.schedule),
    p_auto_sync_enabled: w.autoSyncEnabled,
    p_retry_policy: JSON.stringify(w.retryPolicy),
    p_next_run_at: w.nextRunAt,
    p_profiles: JSON.stringify(profiles),
    p_user_id: userId,
  });
  return toIntegrationRecord(row);
};

export const setSecret = async (id: number, sealed: string | null, userId: number) => {
  await callFunctionSingle('usp_integration_set_secret', { p_integration_id: id, p_secret_ciphertext: sealed, p_user_id: userId });
};

export const getSealedSecret = async (id: number): Promise<string | null> => {
  const [row] = await callFunction<{ secret_ciphertext: string | null }>('usp_integration_get_secret', { p_integration_id: id });
  return row?.secret_ciphertext ?? null;
};

export const deleteIntegration = async (id: number) => {
  await callFunctionSingle('usp_integration_delete', { p_integration_id: id });
};

export const addAudit = async (integrationId: number | null, userId: number | null, action: string, details: Record<string, unknown>) => {
  await callFunctionSingle('usp_integration_audit_add', {
    p_integration_id: integrationId,
    p_actor_user_id: userId,
    p_action: action,
    p_details: JSON.stringify(details),
  });
};

export const resetCursor = async (integrationId: number, profileId: number) => {
  await callFunctionSingle('usp_integration_profile_reset_cursor', { p_integration_id: integrationId, p_profile_id: profileId });
};

interface SummaryRow {
  integration_id: number;
  last_status: string | null;
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  next_run_at: Date | null;
  auto_sync_enabled: boolean;
  last_job: JobRow | null;
  active_job: JobRow | null;
  period_days: number;
  jobs_total: number;
  jobs_succeeded: number;
  jobs_partial: number;
  jobs_failed: number;
  records_fetched: number;
  records_created: number;
  records_updated: number;
  records_unchanged: number;
  records_rejected: number;
  records_failed: number;
  avg_duration_ms: number | null;
  invoices_imported: number;
}

export const getSummary = async (id: number, days: number): Promise<IntegrationSummary | null> => {
  const [r] = await callFunction<SummaryRow>('usp_integration_summary', { p_integration_id: id, p_days: days });
  if (!r) return null;
  return {
    integrationId: r.integration_id,
    lastStatus: r.last_status,
    lastAttemptAt: r.last_attempt_at,
    lastSuccessAt: r.last_success_at,
    nextRunAt: r.next_run_at,
    autoSyncEnabled: r.auto_sync_enabled,
    lastJob: r.last_job ? toJobRecord(r.last_job) : null,
    activeJob: r.active_job ? toJobRecord(r.active_job) : null,
    periodDays: r.period_days,
    totals: {
      jobs: r.jobs_total, succeeded: r.jobs_succeeded, partial: r.jobs_partial, failed: r.jobs_failed,
      fetched: r.records_fetched, created: r.records_created, updated: r.records_updated, unchanged: r.records_unchanged,
      rejected: r.records_rejected, failedRecords: r.records_failed,
      avgDurationMs: r.avg_duration_ms === null ? null : Number(r.avg_duration_ms),
    },
    invoicesImported: r.invoices_imported,
  };
};

export const listJobs = async (integrationId: number, f: JobListFilters) => {
  const rows = await callFunction<{ job: JobRow } & PageColumns>('usp_sync_job_list', {
    p_integration_id: integrationId,
    p_status: f.status ?? null,
    p_trigger_type: f.trigger ?? null,
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_page: f.page,
    p_page_size: f.limit,
  });
  return { rows: rows.map((r) => toJobRecord(r.job)), ...toPageMeta(rows[0], f.limit) };
};

export const getJob = async (integrationId: number, jobId: number): Promise<JobRecord | null> => {
  const [row] = await callFunction<JobRow>('usp_sync_job_get', { p_integration_id: integrationId, p_job_id: jobId });
  return row ? toJobRecord(row) : null;
};

export const cancelJob = async (integrationId: number, jobId: number): Promise<JobRecord> =>
  toJobRecord(await callFunctionSingle<JobRow>('usp_sync_job_cancel', { p_integration_id: integrationId, p_job_id: jobId }));

interface ErrorRow extends PageColumns {
  id: number;
  job_id: number;
  profile_id: number | null;
  profile_name: string | null;
  stage: string;
  external_key: string | null;
  message: string;
  details: Record<string, unknown> | null;
  created_at: Date;
}

export const listJobErrors = async (jobId: number, stage: string | undefined, page: number, limit: number) => {
  const rows = await callFunction<ErrorRow>('usp_sync_error_list', { p_job_id: jobId, p_stage: stage ?? null, p_page: page, p_page_size: limit });
  return {
    rows: rows.map(
      (r): SyncErrorRow => ({
        id: Number(r.id), jobId: r.job_id, profileId: r.profile_id, profileName: r.profile_name, stage: r.stage,
        externalKey: r.external_key, message: r.message, details: r.details, createdAt: r.created_at,
      }),
    ),
    ...toPageMeta(rows[0], limit),
  };
};
