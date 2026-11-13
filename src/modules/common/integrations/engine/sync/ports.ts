import type { SourceDocument } from '../core/contracts.js';
import type { CanonicalInvoice } from '../core/mapping/field-mapper.js';

/**
 * Persistence ports of the synchronization core (Repository pattern). The orchestrator, worker
 * and scheduler depend on these interfaces; PostgreSQL implementations live in ../persistence,
 * in-memory ones in the tests.
 */

/** An integration as stored (JSON settings not yet validated). */
export interface IntegrationRecord {
  id: string;
  providerType: string;
  name: string;
  description: string | null;
  environment: string | null;
  sourceSystem: string;
  isActive: boolean;
  connection: Record<string, unknown>;
  authType: string;
  authSettings: Record<string, unknown>;
  secretConfigured: boolean;
  secretUpdatedAt: Date | null;
  schedule: Record<string, unknown>;
  autoSyncEnabled: boolean;
  retryPolicy: Record<string, unknown>;
  nextRunAt: Date | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastStatus: string | null;
  lastJobId: string | null;
  version: number;
  profiles: ProfileRecord[];
  createdAt: Date;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface ProfileRecord {
  id: string;
  integrationId: string;
  moduleId: string;
  moduleSlug: string;
  moduleName: string;
  applicationCode: string;
  invoicePrefix: string;
  name: string;
  isActive: boolean;
  settings: Record<string, unknown>;
  keyFields: unknown;
  invoiceCodeTemplate: string;
  fieldMapping: Record<string, unknown>;
  cancellationRule: Record<string, unknown> | null;
  defaultStatus: string;
  initialFrom: Date | null;
  watermark: Date | null;
  watermarkUpdatedAt: Date | null;
  sortOrder: number;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled';
export type JobTrigger = 'scheduled' | 'manual' | 'retry';

export interface JobRecord {
  id: string;
  integrationId: string;
  integrationName: string;
  triggerType: JobTrigger;
  requestedBy: string | null;
  requestedByName: string | null;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  retryOfJobId: string | null;
  runAfter: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  workerId: string | null;
  cancelRequested: boolean;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsRejected: number;
  recordsFailed: number;
  pagesProcessed: number;
  profileStats: Record<string, unknown>;
  errorSummary: string | null;
  errorCount: number;
  durationMs: number | null;
  createdAt: Date;
}

export interface SyncErrorInput {
  externalKey: string | null;
  stage: 'fetch' | 'mapping' | 'validation' | 'persistence' | 'review';
  message: string;
  details?: Record<string, unknown> | null;
}

export interface PageRow {
  rowNo: number;
  invoice: CanonicalInvoice;
  payloadHash: string;
}

export interface PageApplyInput {
  jobId: string;
  workerId: string;
  profileId: string;
  fetched: number;
  rows: PageRow[];
  rejects: SyncErrorInput[];
  watermark: Date | null;
}

export type RowOutcomeKind = 'created' | 'updated' | 'unchanged' | 'skipped' | 'rejected' | 'failed';

export interface RowOutcome {
  rowNo: number;
  externalKey: string;
  outcome: RowOutcomeKind;
  invoiceCode: string | null;
  message: string | null;
}

/** What the orchestrator needs to run a job. */
export interface SyncStore {
  loadIntegration(integrationId: string): Promise<IntegrationRecord | null>;
  loadSecret(integrationId: string): Promise<string | null>;
  /** One transaction: rows upserted, rejects recorded, counters + watermark updated. */
  applyPage(input: PageApplyInput): Promise<RowOutcome[]>;
  addErrors(jobId: string, profileId: string | null, errors: SyncErrorInput[]): Promise<void>;
}

export interface EnqueueRequest {
  integrationId: string;
  trigger: JobTrigger;
  requestedBy: string | null;
  retryOfJobId?: string | null;
  attempt?: number;
  runAfter?: Date | null;
}

/** Queue operations used by the worker, the scheduler and the API. */
export interface JobQueue {
  enqueue(request: EnqueueRequest): Promise<JobRecord>;
  claim(workerId: string): Promise<JobRecord | null>;
  heartbeat(jobId: string, workerId: string): Promise<JobRecord>;
  finish(jobId: string, workerId: string, status: JobStatus, summary: string | null): Promise<JobRecord>;
  release(jobId: string, workerId: string): Promise<boolean>;
  recoverStale(staleSeconds: number): Promise<JobRecord[]>;
  dueIntegrations(limit: number): Promise<IntegrationRecord[]>;
  setNextRun(integrationId: string, nextRunAt: Date | null): Promise<void>;
  purgeHistory(keepDays: number): Promise<number>;
}

/** Stores source documents (e.g. OnBase PDFs) as invoice attachments. */
export interface AttachmentStore {
  /** Invoice codes (of those given, in the profile module's app) that have no attachment yet. */
  withoutAttachment(moduleSlug: string, invoiceCodes: string[]): Promise<Set<string>>;
  /** Saves the file and registers it as the invoice's primary attachment (invoices are per app). */
  save(moduleSlug: string, invoiceCode: string, document: SourceDocument, sourceKey: string): Promise<void>;
}

/** Raised by the queue when the database reports a conflict (e.g. a job is already active). */
export class QueueConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueConflictError';
  }
}
