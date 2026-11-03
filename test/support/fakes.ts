import { AuthStrategyRegistry } from '../../src/modules/common/integrations/engine/core/auth/auth-strategy.js';
import { builtInAuthStrategies } from '../../src/modules/common/integrations/engine/core/auth/strategies.js';
import { ProviderContextFactory } from '../../src/modules/common/integrations/engine/core/context-factory.js';
import { SyncEvents } from '../../src/modules/common/integrations/engine/core/events.js';
import type { ConfigDependencies } from '../../src/modules/common/integrations/engine/core/integration-config.js';
import { silentLogger } from '../../src/modules/common/integrations/engine/core/logger.js';
import { ProviderRegistry } from '../../src/modules/common/integrations/engine/core/provider-registry.js';
import { AesGcmSecretStore } from '../../src/modules/common/integrations/engine/core/secrets/secret-store.js';
import type { IntegrationProvider, SourceDocument } from '../../src/modules/common/integrations/engine/core/contracts.js';
import { SyncOrchestrator } from '../../src/modules/common/integrations/engine/sync/sync-orchestrator.js';
import {
  QueueConflictError,
  type AttachmentStore,
  type EnqueueRequest,
  type IntegrationRecord,
  type JobQueue,
  type JobRecord,
  type JobStatus,
  type PageApplyInput,
  type ProfileRecord,
  type RowOutcome,
  type SyncErrorInput,
  type SyncStore,
} from '../../src/modules/common/integrations/engine/sync/ports.js';

/** Test doubles mirroring the semantics of the PostgreSQL functions (see database/postgres/tests). */

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

export const baseMapping = {
  vendorName: { path: 'InvoicingPartyName' },
  cuit: { path: 'TaxNumber1', transform: 'cuit' },
  invoice1a: { path: 'SupplierInvoiceIDByInvcgParty' },
  invoiceDate: { path: 'DocumentDate', transform: 'date' },
  receptionDate: { path: 'PostingDate', transform: 'date' },
  currencyCode: { path: 'DocumentCurrency', transform: 'upper' },
  amount: { path: 'InvoiceGrossAmount', transform: 'number' },
};

export const profileRecord = (overrides: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id: 11,
  integrationId: 1,
  moduleId: 1,
  moduleSlug: 'GP',
  moduleName: 'General Payments',
  applicationCode: 'GP',
  invoicePrefix: 'GP',
  name: 'General Payments',
  isActive: true,
  settings: { entitySet: 'A_SupplierInvoice', incrementalField: 'LastChangeDateTime', incrementalFieldType: 'DateTimeOffset', overlapMinutes: 0 },
  keyFields: ['CompanyCode', 'FiscalYear', 'SupplierInvoice'],
  invoiceCodeTemplate: 'INV-{prefix}-SAP-{SupplierInvoice}-{FiscalYear}',
  fieldMapping: baseMapping,
  cancellationRule: { field: 'ReverseDocument', operator: 'notEmpty' },
  defaultStatus: 'Pending',
  initialFrom: null,
  watermark: null,
  watermarkUpdatedAt: null,
  sortOrder: 0,
  ...overrides,
});

export const integrationRecord = (overrides: Partial<IntegrationRecord> = {}): IntegrationRecord => ({
  id: 1,
  providerType: 'sap-odata',
  name: 'SAP test',
  description: null,
  environment: 'QA',
  sourceSystem: 'S4T-100',
  isActive: true,
  connection: { baseUrl: 'http://localhost:4999', servicePath: '/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV', odataVersion: 'v2', maxRetries: 2 },
  authType: 'none',
  authSettings: {},
  secretConfigured: false,
  secretUpdatedAt: null,
  schedule: { mode: 'interval', intervalMinutes: 15, timezone: 'UTC' },
  autoSyncEnabled: false,
  retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, maxDelaySeconds: 60 },
  nextRunAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: null,
  lastJobId: null,
  version: 1,
  profiles: [profileRecord()],
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedByName: null,
  ...overrides,
});

export const jobRecord = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  id: 100,
  integrationId: 1,
  integrationName: 'SAP test',
  triggerType: 'manual',
  requestedBy: 1,
  requestedByName: 'Admin',
  status: 'running',
  attempt: 1,
  maxAttempts: 3,
  retryOfJobId: null,
  runAfter: new Date(),
  startedAt: new Date(),
  finishedAt: null,
  heartbeatAt: new Date(),
  workerId: 'w1',
  cancelRequested: false,
  recordsFetched: 0,
  recordsCreated: 0,
  recordsUpdated: 0,
  recordsUnchanged: 0,
  recordsRejected: 0,
  recordsFailed: 0,
  pagesProcessed: 0,
  profileStats: {},
  errorSummary: null,
  errorCount: 0,
  durationMs: null,
  createdAt: new Date(),
  ...overrides,
});

interface StoredInvoice {
  invoiceCode: string;
  amount: number;
  status: string;
  hash: string;
  cancelled: boolean;
}

export class InMemorySyncStore implements SyncStore {
  integration: IntegrationRecord;
  sealedSecret: string | null = null;
  readonly invoices = new Map<string, StoredInvoice>(); // by external key
  readonly errors: (SyncErrorInput & { jobId: number; profileId: number | null })[] = [];
  readonly pages: PageApplyInput[] = [];
  /** External keys whose upsert fails with a database error. */
  readonly failKeys = new Set<string>();
  /** Throw on the Nth applyPage call (simulates a crash / lost connection mid-job). */
  crashOnPage: number | null = null;

  constructor(integration: IntegrationRecord = integrationRecord()) {
    this.integration = integration;
  }

  async loadIntegration(id: number) {
    return id === this.integration.id ? this.integration : null;
  }

  async loadSecret() {
    return this.sealedSecret;
  }

  async applyPage(input: PageApplyInput): Promise<RowOutcome[]> {
    this.pages.push(input);
    if (this.crashOnPage !== null && this.pages.length === this.crashOnPage) throw new Error('connection terminated unexpectedly');
    for (const r of input.rejects) this.errors.push({ ...r, jobId: input.jobId, profileId: input.profileId });
    const outcomes: RowOutcome[] = input.rows.map(({ rowNo, invoice, payloadHash }) => {
      const base = { rowNo, externalKey: invoice.externalKey, invoiceCode: invoice.invoiceCode };
      if (this.failKeys.has(invoice.externalKey)) {
        this.errors.push({ externalKey: invoice.externalKey, stage: 'persistence', message: 'db error', jobId: input.jobId, profileId: input.profileId });
        return { ...base, outcome: 'failed', message: 'db error' };
      }
      const existing = this.invoices.get(invoice.externalKey);
      if (!existing) {
        if (invoice.cancelled) return { ...base, outcome: 'skipped', message: 'cancelled before import' };
        this.invoices.set(invoice.externalKey, { invoiceCode: invoice.invoiceCode, amount: invoice.amount, status: 'Pending', hash: payloadHash, cancelled: false });
        return { ...base, outcome: 'created', message: null };
      }
      if (existing.hash === payloadHash) return { ...base, outcome: 'unchanged', message: null };
      existing.amount = invoice.amount;
      existing.hash = payloadHash;
      if (invoice.cancelled && !existing.cancelled && existing.status === 'Pending') existing.status = 'Rejected';
      existing.cancelled = invoice.cancelled;
      return { ...base, outcome: 'updated', message: null };
    });
    const profile = this.integration.profiles.find((p) => p.id === input.profileId);
    if (profile && input.watermark && !outcomes.some((o) => o.outcome === 'failed')) {
      if (!profile.watermark || input.watermark > profile.watermark) profile.watermark = input.watermark;
    }
    return outcomes;
  }

  async addErrors(jobId: number, profileId: number | null, errors: SyncErrorInput[]) {
    for (const e of errors) this.errors.push({ ...e, jobId, profileId });
  }
}

export class InMemoryJobQueue implements JobQueue {
  readonly jobs: JobRecord[] = [];
  integrations: IntegrationRecord[] = [];
  readonly nextRuns = new Map<number, Date | null>();
  purged = 0;
  private seq = 1;

  async enqueue(r: EnqueueRequest): Promise<JobRecord> {
    if (this.jobs.some((j) => j.integrationId === r.integrationId && (j.status === 'queued' || j.status === 'running'))) {
      throw new QueueConflictError('A synchronization is already queued or running for this integration.');
    }
    const job = jobRecord({
      id: this.seq++, integrationId: r.integrationId, triggerType: r.trigger, requestedBy: r.requestedBy, status: 'queued',
      attempt: r.attempt ?? 1, retryOfJobId: r.retryOfJobId ?? null, runAfter: r.runAfter ?? new Date(0), startedAt: null, workerId: null,
    });
    this.jobs.push(job);
    return job;
  }

  async claim(workerId: string) {
    const job = this.jobs.find((j) => j.status === 'queued' && j.runAfter.getTime() <= Date.now());
    if (!job) return null;
    Object.assign(job, { status: 'running', workerId, startedAt: new Date(), heartbeatAt: new Date() });
    return { ...job };
  }

  async heartbeat(jobId: number, workerId: string) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'running' || job.workerId !== workerId) throw new QueueConflictError('not owned');
    job.heartbeatAt = new Date();
    return { ...job };
  }

  async finish(jobId: number, workerId: string, status: JobStatus, summary: string | null) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'running' || job.workerId !== workerId) throw new QueueConflictError('not owned');
    Object.assign(job, { status, errorSummary: summary, finishedAt: new Date() });
    return { ...job };
  }

  async release(jobId: number, workerId: string) {
    const job = this.jobs.find((j) => j.id === jobId && j.workerId === workerId && j.status === 'running');
    if (!job) return false;
    Object.assign(job, { status: 'queued', workerId: null });
    return true;
  }

  async recoverStale(staleSeconds: number) {
    const limit = Date.now() - staleSeconds * 1000;
    const stale = this.jobs.filter((j) => j.status === 'running' && j.heartbeatAt && j.heartbeatAt.getTime() < limit);
    for (const j of stale) Object.assign(j, { status: 'failed', finishedAt: new Date(), errorSummary: 'stale' });
    return stale.map((j) => ({ ...j }));
  }

  async dueIntegrations() {
    return this.integrations.filter((i) => i.isActive && i.autoSyncEnabled && (!i.nextRunAt || i.nextRunAt <= new Date()));
  }

  async setNextRun(id: number, next: Date | null) {
    this.nextRuns.set(id, next);
    const integration = this.integrations.find((i) => i.id === id);
    if (integration) integration.nextRunAt = next;
  }

  async purgeHistory() {
    this.purged += 1;
    return 0;
  }
}

export const testConfigDeps = (providers: ProviderRegistry): ConfigDependencies => {
  const authStrategies = new AuthStrategyRegistry();
  for (const s of builtInAuthStrategies) authStrategies.register(s);
  return { providers, authStrategies, urlPolicy: { allowedHosts: [], allowLocalHttp: true } };
};

/** Orchestrator wired with in-memory persistence and the given providers (no sleeping on retries). */
/** Records attached documents in memory (orchestrator document step). */
export class InMemoryAttachmentStore implements AttachmentStore {
  readonly saved = new Map<string, SourceDocument & { sourceKey: string }>();
  failFor = new Set<string>();

  async withoutAttachment(_moduleSlug: string, codes: string[]) {
    return new Set(codes.filter((c) => !this.saved.has(c)));
  }

  async save(_moduleSlug: string, invoiceCode: string, document: SourceDocument, sourceKey: string) {
    if (this.failFor.has(invoiceCode)) throw new Error('disk full');
    this.saved.set(invoiceCode, { ...document, sourceKey });
  }
}

export const createTestOrchestrator = (store: SyncStore, ...extraProviders: IntegrationProvider[]) =>
  createTestOrchestratorWith(store, null, ...extraProviders);

export const createTestOrchestratorWith = (store: SyncStore, attachments: AttachmentStore | null, ...extraProviders: IntegrationProvider[]) => {
  const providers = new ProviderRegistry();
  for (const p of extraProviders) providers.register(p);
  const config = testConfigDeps(providers);
  const events = new SyncEvents();
  const contexts = new ProviderContextFactory({
    providers,
    authStrategies: config.authStrategies,
    secrets: new AesGcmSecretStore(TEST_KEY),
    logger: silentLogger,
    sleep: async () => {},
  });
  return {
    orchestrator: new SyncOrchestrator({ store, attachments: attachments ?? undefined, contexts, config, events, logger: silentLogger }),
    events,
    providers,
    config,
  };
};

export const control = (overrides: Partial<{ cancelAfter: number; signal: AbortSignal }> = {}) => {
  let beats = 0;
  return {
    workerId: 'w1',
    signal: overrides.signal ?? new AbortController().signal,
    heartbeats: () => beats,
    heartbeat: async () => {
      beats += 1;
      return { cancelRequested: overrides.cancelAfter !== undefined && beats >= overrides.cancelAfter };
    },
  };
};
