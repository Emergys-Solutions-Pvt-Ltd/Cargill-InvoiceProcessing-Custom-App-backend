import type { ConfigDependencies } from '../core/integration-config.js';
import { resolveIntegrationConfig } from '../core/integration-config.js';
import type { DocumentFetcher, InvoiceExtractor, IntegrationConfig, ProfileConfig } from '../core/contracts.js';
import type { ProviderContextFactory } from '../core/context-factory.js';
import { IntegrationError, errorMessage, isIntegrationError } from '../core/errors.js';
import type { PageCounters, SyncEvents } from '../core/events.js';
import { mapRecord } from '../core/mapping/field-mapper.js';
import type { Logger } from '../core/logger.js';
import type { AttachmentStore, JobRecord, PageRow, RowOutcome, SyncErrorInput, SyncStore } from './ports.js';

/**
 * Synchronization workflow (Template Method): the steps and their order are fixed here and are
 * the same for every provider; the provider only supplies the extraction step through
 * InvoiceExtractor. Per profile:
 *   extract page -> map + validate every record -> persist page (one transaction, row savepoints,
 *   counters + cursor in the same transaction) -> heartbeat / cancellation check -> next page
 *
 * Outcome rules
 *   succeeded            every record created / updated / unchanged
 *   partially_succeeded  some records rejected or failed (data problems - not retried)
 *   failed               a profile could not be extracted (network, auth, bad query); retried
 *                        when the cause is transient
 *   cancelled            an administrator asked to stop (pages already saved stay saved)
 *   interrupted          the worker is shutting down; the job is put back in the queue
 */

export type RunStatus = 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface RunOutcome {
  status: RunStatus;
  summary: string | null;
  retryable: boolean;
  counters: PageCounters;
}

export interface RunControl {
  workerId: string;
  signal: AbortSignal;
  /** Persists liveness; returns whether an administrator asked to cancel. */
  heartbeat(): Promise<{ cancelRequested: boolean }>;
}

export interface OrchestratorDependencies {
  store: SyncStore;
  /** Needed only by providers that supply documents (ECM, e.g. OnBase). */
  attachments?: AttachmentStore;
  contexts: ProviderContextFactory;
  config: ConfigDependencies;
  events: SyncEvents;
  logger: Logger;
}

export const SHUTDOWN_REASON = 'shutdown';

const emptyCounters = (): PageCounters => ({ fetched: 0, created: 0, updated: 0, unchanged: 0, rejected: 0, failed: 0 });

export class SyncOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async run(job: JobRecord, control: RunControl): Promise<RunOutcome> {
    const started = Date.now();
    const ref = { jobId: job.id, integrationId: job.integrationId, integrationName: job.integrationName, trigger: job.triggerType, attempt: job.attempt };
    const counters = emptyCounters();
    const log = this.deps.logger.child({ jobId: job.id, integrationId: job.integrationId });
    this.deps.events.emit('job.started', ref);

    let outcome: RunOutcome;
    try {
      const config = await this.loadConfig(job.integrationId);
      const sealed = await this.deps.store.loadSecret(job.integrationId);
      const { provider, context } = this.deps.contexts.create(config, sealed);
      const extractor = provider.createExtractor(context);
      const documents = provider.createDocumentFetcher?.(context) ?? null;
      const docCounters = { attached: 0, failed: 0 };

      const failures: IntegrationError[] = [];
      for (const profile of config.profiles.filter((p) => p.isActive)) {
        try {
          await this.runProfile(job, profile, extractor, control, counters, ref, documents, docCounters);
          this.deps.events.emit('profile.finished', { ...ref, profileId: profile.id, ok: true });
        } catch (err) {
          if (control.signal.aborted || (isIntegrationError(err) && err.code === 'CANCELLED')) throw err;
          const error = isIntegrationError(err) ? err : new IntegrationError('HTTP_ERROR', errorMessage(err), false);
          failures.push(error);
          await this.deps.store.addErrors(job.id, profile.id, [{ externalKey: null, stage: 'fetch', message: error.message, details: { code: error.code } }]);
          this.deps.events.emit('profile.finished', { ...ref, profileId: profile.id, ok: false, message: error.message });
          // Credentials are shared by all profiles: no point trying the others
          if (error.code === 'AUTH_FAILED' || error.code === 'SECRET_UNAVAILABLE') break;
        }
      }

      if (failures.length > 0) {
        outcome = {
          status: 'failed',
          summary: failures.map((f) => f.message).join(' | ').slice(0, 1900),
          retryable: failures.some((f) => f.retryable),
          counters,
        };
      } else if (counters.rejected + counters.failed + docCounters.failed > 0) {
        outcome = {
          status: 'partially_succeeded',
          summary: [
            counters.rejected + counters.failed > 0 ? `${counters.rejected} record(s) rejected, ${counters.failed} failed to save.` : '',
            docCounters.failed > 0 ? `${docCounters.failed} document(s) could not be attached (retried next run).` : '',
            'See the error details.',
          ].filter(Boolean).join(' '),
          retryable: false,
          counters,
        };
      } else {
        outcome = { status: 'succeeded', summary: null, retryable: false, counters };
      }
    } catch (err) {
      if (control.signal.aborted && control.signal.reason === SHUTDOWN_REASON) {
        outcome = { status: 'interrupted', summary: 'Interrupted by a server shutdown; resumed by the next worker', retryable: false, counters };
      } else if (control.signal.aborted || (isIntegrationError(err) && err.code === 'CANCELLED')) {
        outcome = { status: 'cancelled', summary: 'Cancelled by an administrator', retryable: false, counters };
      } else {
        const message = errorMessage(err);
        log.error('Sync job failed', { error: message });
        await this.deps.store.addErrors(job.id, null, [{ externalKey: null, stage: 'fetch', message, details: isIntegrationError(err) ? { code: err.code } : null }]).catch(() => {});
        outcome = { status: 'failed', summary: message.slice(0, 1900), retryable: isIntegrationError(err) && err.retryable, counters };
      }
    }

    this.deps.events.emit('job.finished', { ...ref, status: outcome.status, durationMs: Date.now() - started, summary: outcome.summary });
    return outcome;
  }

  /**
   * Attaches the source document (e.g. the OnBase PDF) to saved invoices that have no attachment yet.
   * A failure keeps the invoice, records an error and is retried on the next run (the invoice still
   * has no attachment then).
   */
  private async attachDocuments(
    job: JobRecord,
    profile: ProfileConfig,
    records: Record<string, unknown>[],
    outcomes: RowOutcome[],
    documents: DocumentFetcher,
    control: RunControl,
    docCounters: { attached: number; failed: number },
  ) {
    const store = this.deps.attachments;
    if (!store) return;
    const saved = outcomes.filter((o) => o.invoiceCode && ['created', 'updated', 'unchanged'].includes(o.outcome));
    if (saved.length === 0) return;
    const missing = await store.withoutAttachment(profile.moduleSlug, saved.map((o) => o.invoiceCode!));
    for (const o of saved.filter((x) => missing.has(x.invoiceCode!))) {
      if (control.signal.aborted) throw IntegrationError.cancelled();
      try {
        const document = await documents.fetch(records[o.rowNo - 1], profile, control.signal);
        await store.save(profile.moduleSlug, o.invoiceCode!, document, o.externalKey);
        docCounters.attached += 1;
      } catch (err) {
        if (control.signal.aborted || (isIntegrationError(err) && err.code === 'CANCELLED')) throw err;
        docCounters.failed += 1;
        await this.deps.store.addErrors(job.id, profile.id, [
          { externalKey: o.externalKey, stage: 'fetch', message: `Document not attached: ${errorMessage(err)}`.slice(0, 1900), details: { invoiceCode: o.invoiceCode } },
        ]);
      }
    }
  }

  private async loadConfig(integrationId: string): Promise<IntegrationConfig> {
    const record = await this.deps.store.loadIntegration(integrationId);
    if (!record) throw IntegrationError.config('The integration no longer exists');
    if (!record.isActive) throw IntegrationError.config('The integration is inactive');
    const config = resolveIntegrationConfig(record, this.deps.config);
    if (!config.profiles.some((p) => p.isActive)) throw IntegrationError.config('The integration has no active extraction profile');
    return config;
  }

  private async runProfile(
    job: JobRecord,
    profile: ProfileConfig,
    extractor: InvoiceExtractor,
    control: RunControl,
    counters: PageCounters,
    ref: { jobId: string; integrationId: string },
    documents: DocumentFetcher | null = null,
    docCounters = { attached: 0, failed: 0 },
  ) {
    const incremental = extractor.isIncremental(profile);
    const since = incremental ? (profile.watermark ?? profile.initialFrom) : profile.initialFrom;
    let advanceCursor = incremental;
    this.deps.events.emit('profile.started', { ...ref, profileId: profile.id, profileName: profile.name, since: since?.toISOString() ?? null });

    for await (const page of extractor.extract({ profile, since, signal: control.signal })) {
      if (control.signal.aborted) throw IntegrationError.cancelled();

      const rows: PageRow[] = [];
      const rejects: SyncErrorInput[] = [];
      let pageMax: Date | null = null;
      page.records.forEach((record, index) => {
        const changedAt = extractor.changedAt(record, profile);
        if (changedAt && (!pageMax || changedAt > pageMax)) pageMax = changedAt;
        const result = mapRecord(record, profile, changedAt);
        if (result.ok) rows.push({ rowNo: index + 1, invoice: result.invoice, payloadHash: result.payloadHash });
        else rejects.push({ externalKey: result.externalKey, stage: result.stage, message: result.message, details: result.details });
      });

      const outcomes = await this.deps.store.applyPage({
        jobId: job.id,
        workerId: control.workerId,
        profileId: profile.id,
        fetched: page.records.length,
        rows,
        rejects,
        watermark: advanceCursor ? pageMax : null,
      });

      const pageCounters: PageCounters = {
        fetched: page.records.length,
        created: outcomes.filter((o) => o.outcome === 'created').length,
        updated: outcomes.filter((o) => o.outcome === 'updated').length,
        unchanged: outcomes.filter((o) => o.outcome === 'unchanged' || o.outcome === 'skipped').length,
        rejected: rejects.length + outcomes.filter((o) => o.outcome === 'rejected').length,
        failed: outcomes.filter((o) => o.outcome === 'failed').length,
      };
      // A record that failed to save must be read again: freeze the cursor for the rest of this run
      if (pageCounters.failed > 0) advanceCursor = false;
      for (const key of Object.keys(counters) as (keyof PageCounters)[]) counters[key] += pageCounters[key];
      this.deps.events.emit('page.processed', { ...ref, profileId: profile.id, pageNumber: page.pageNumber, counters: pageCounters });

      if (documents?.isEnabled(profile)) {
        await this.attachDocuments(job, profile, page.records, outcomes, documents, control, docCounters);
      }

      const { cancelRequested } = await control.heartbeat();
      if (cancelRequested) throw IntegrationError.cancelled();
    }
  }
}
