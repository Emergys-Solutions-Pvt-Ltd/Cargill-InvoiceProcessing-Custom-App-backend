import type { JobRecord } from './engine/sync/ports.js';

export interface ProfileWrite {
  id: string | null;
  moduleId: string;
  /** Target module details (not persisted here; used to evaluate unsaved profiles in connection tests). */
  module: { slug: string; name: string; applicationCode: string; invoicePrefix: string };
  name: string;
  isActive: boolean;
  settings: Record<string, unknown>;
  keyFields: string[];
  invoiceCodeTemplate: string;
  fieldMapping: Record<string, unknown>;
  cancellationRule: Record<string, unknown> | null;
  defaultStatus: string;
  initialFrom: Date | null;
  sortOrder: number;
}

export interface IntegrationWrite {
  id: string | null;
  expectedVersion: number | null;
  providerType: string;
  name: string;
  description: string | null;
  environment: string | null;
  sourceSystem: string;
  isActive: boolean;
  connection: Record<string, unknown>;
  authType: string;
  authSettings: Record<string, unknown>;
  clearSecret: boolean;
  schedule: Record<string, unknown>;
  autoSyncEnabled: boolean;
  retryPolicy: Record<string, unknown>;
  nextRunAt: Date | null;
  profiles: ProfileWrite[];
}

export interface SyncErrorRow {
  id: string;
  jobId: string;
  profileId: string | null;
  profileName: string | null;
  stage: string;
  externalKey: string | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface IntegrationSummary {
  integrationId: string;
  lastStatus: string | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  autoSyncEnabled: boolean;
  lastJob: JobRecord | null;
  activeJob: JobRecord | null;
  periodDays: number;
  totals: {
    jobs: number;
    succeeded: number;
    partial: number;
    failed: number;
    fetched: number;
    created: number;
    updated: number;
    unchanged: number;
    rejected: number;
    failedRecords: number;
    avgDurationMs: number | null;
  };
  invoicesImported: number;
}

export interface JobListFilters {
  status?: string;
  trigger?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}
