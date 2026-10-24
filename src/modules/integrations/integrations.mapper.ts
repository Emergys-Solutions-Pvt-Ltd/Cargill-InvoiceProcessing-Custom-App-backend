import type { IntegrationRecord, JobRecord, ProfileRecord } from '../../integrations/sync/ports.js';
import type { IntegrationSummary, SyncErrorRow } from './integrations.repository.js';

/**
 * API representations. Secrets are never part of IntegrationRecord (the database functions do not
 * return them); the response only says whether credentials are configured and when they changed.
 */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const toProfileDto = (p: ProfileRecord) => ({
  id: p.id,
  name: p.name,
  isActive: p.isActive,
  moduleSlug: p.moduleSlug,
  moduleName: p.moduleName,
  applicationCode: p.applicationCode,
  invoicePrefix: p.invoicePrefix,
  settings: p.settings,
  keyFields: p.keyFields,
  invoiceCodeTemplate: p.invoiceCodeTemplate,
  fieldMapping: p.fieldMapping,
  cancellationRule: p.cancellationRule,
  defaultStatus: p.defaultStatus,
  initialFrom: iso(p.initialFrom),
  cursor: { watermark: iso(p.watermark), updatedAt: iso(p.watermarkUpdatedAt) },
  sortOrder: p.sortOrder,
});

export const toIntegrationDto = (r: IntegrationRecord) => ({
  id: r.id,
  providerType: r.providerType,
  name: r.name,
  description: r.description,
  environment: r.environment,
  sourceSystem: r.sourceSystem,
  isActive: r.isActive,
  connection: r.connection,
  authType: r.authType,
  authSettings: r.authSettings,
  secret: { configured: r.secretConfigured, updatedAt: iso(r.secretUpdatedAt) },
  schedule: r.schedule,
  autoSyncEnabled: r.autoSyncEnabled,
  retryPolicy: r.retryPolicy,
  status: {
    lastStatus: r.lastStatus,
    lastAttemptAt: iso(r.lastAttemptAt),
    lastSuccessAt: iso(r.lastSuccessAt),
    nextRunAt: r.autoSyncEnabled && r.isActive ? iso(r.nextRunAt) : null,
    lastJobId: r.lastJobId,
  },
  version: r.version,
  profiles: r.profiles.map(toProfileDto),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  updatedBy: r.updatedByName,
});

/** List rows: no connection / mapping details. */
export const toIntegrationListItem = (r: IntegrationRecord) => ({
  id: r.id,
  providerType: r.providerType,
  name: r.name,
  description: r.description,
  environment: r.environment,
  sourceSystem: r.sourceSystem,
  isActive: r.isActive,
  autoSyncEnabled: r.autoSyncEnabled,
  profiles: r.profiles.map((p) => ({ id: p.id, name: p.name, moduleSlug: p.moduleSlug, isActive: p.isActive })),
  status: {
    lastStatus: r.lastStatus,
    lastAttemptAt: iso(r.lastAttemptAt),
    lastSuccessAt: iso(r.lastSuccessAt),
    nextRunAt: r.autoSyncEnabled && r.isActive ? iso(r.nextRunAt) : null,
  },
  updatedAt: iso(r.updatedAt),
});

export const toJobDto = (j: JobRecord) => ({
  id: j.id,
  integrationId: j.integrationId,
  trigger: j.triggerType,
  requestedBy: j.requestedByName,
  status: j.status,
  attempt: j.attempt,
  maxAttempts: j.maxAttempts,
  retryOfJobId: j.retryOfJobId,
  runAfter: iso(j.runAfter),
  startedAt: iso(j.startedAt),
  finishedAt: iso(j.finishedAt),
  heartbeatAt: iso(j.heartbeatAt),
  cancelRequested: j.cancelRequested,
  durationMs: j.durationMs,
  records: {
    fetched: j.recordsFetched,
    created: j.recordsCreated,
    updated: j.recordsUpdated,
    unchanged: j.recordsUnchanged,
    rejected: j.recordsRejected,
    failed: j.recordsFailed,
  },
  pages: j.pagesProcessed,
  profileStats: j.profileStats,
  errorSummary: j.errorSummary,
  errorCount: j.errorCount,
  createdAt: iso(j.createdAt),
});

export const toErrorDto = (e: SyncErrorRow) => ({
  id: e.id,
  profileId: e.profileId,
  profileName: e.profileName,
  stage: e.stage,
  externalKey: e.externalKey,
  message: e.message,
  details: e.details,
  createdAt: iso(e.createdAt),
});

export const toSummaryDto = (s: IntegrationSummary) => ({
  integrationId: s.integrationId,
  lastStatus: s.lastStatus,
  lastAttemptAt: iso(s.lastAttemptAt),
  lastSuccessAt: iso(s.lastSuccessAt),
  nextRunAt: s.autoSyncEnabled ? iso(s.nextRunAt) : null,
  autoSyncEnabled: s.autoSyncEnabled,
  lastJob: s.lastJob ? toJobDto(s.lastJob) : null,
  activeJob: s.activeJob ? toJobDto(s.activeJob) : null,
  periodDays: s.periodDays,
  totals: s.totals,
  invoicesImported: s.invoicesImported,
});
