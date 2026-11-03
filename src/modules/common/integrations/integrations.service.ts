import type { z } from 'zod';
import type { AuthStrategyRegistry } from './engine/core/auth/auth-strategy.js';
import type { ProviderContextFactory } from './engine/core/context-factory.js';
import type { ConnectionTestResult, IntegrationConfig } from './engine/core/contracts.js';
import { errorMessage, isIntegrationError } from './engine/core/errors.js';
import {
  resolveIntegrationConfig,
  validateConnectionParts,
  validateProfileParts,
  type ConfigDependencies,
  type FieldProblems,
} from './engine/core/integration-config.js';
import { CANONICAL_FIELDS, TRANSFORMS } from './engine/core/mapping/field-mapper.js';
import type { ProviderRegistry } from './engine/core/provider-registry.js';
import { computeNextRun, retryPolicySchema, scheduleSchema } from './engine/core/schedule.js';
import type { SecretStore } from './engine/core/secrets/secret-store.js';
import { QueueConflictError, type IntegrationRecord, type JobQueue } from './engine/sync/ports.js';
import { HttpError } from '../../../core/http/http-error.js';
import type { AppModule } from '../apps/apps.models.js';
import type * as Repository from './integrations.dal.js';
import type { IntegrationWrite, JobListFilters, ProfileWrite } from './integrations.models.js';
import { toErrorDto, toIntegrationDto, toIntegrationListItem, toJobDto, toSummaryDto } from './integrations.mapper.js';
import type { integrationBody, updateBody } from './integrations.schemas.js';

/**
 * Integration Configuration Service + sync control for Settings > SAP Configuration.
 * Validation, credential handling (seal / write-only), connection tests, manual runs, retries,
 * cancellation and auditing. Persistence, providers and the queue are injected.
 */
export type IntegrationInput = z.infer<typeof integrationBody>;
export type IntegrationUpdate = z.infer<typeof updateBody>;

export interface IntegrationServiceDependencies {
  repo: typeof Repository;
  providers: ProviderRegistry;
  authStrategies: AuthStrategyRegistry;
  secrets: SecretStore;
  contexts: ProviderContextFactory;
  config: ConfigDependencies;
  queue: JobQueue;
  resolveModule: (slug: string) => Promise<AppModule | null>;
  /** Called after a job was queued in this process (wakes the in-process worker). */
  onEnqueued?: () => void;
  now?: () => Date;
  testTimeoutMs?: number;
}

const validationFailed = (problems: FieldProblems) =>
  HttpError.badRequest('Validation failed', { formErrors: [], fieldErrors: problems });

const RETRYABLE_STATUSES = new Set(['failed', 'partially_succeeded', 'cancelled']);

export class IntegrationService {
  constructor(private readonly deps: IntegrationServiceDependencies) {}

  // ---------------------------------------------------------------- catalog

  catalog() {
    return {
      providers: this.deps.providers.list().map((p) => ({
        type: p.type,
        displayName: p.displayName,
        description: p.description,
        supportedAuthTypes: p.supportedAuthTypes,
        templates: p.templates,
      })),
      authTypes: this.deps.authStrategies.list().map((a) => ({
        type: a.type,
        label: a.label,
        description: a.description,
        settingsFields: a.settingsFields,
        secretFields: a.secretFields,
      })),
      canonicalFields: CANONICAL_FIELDS,
      transforms: TRANSFORMS,
      schedulePresets: [
        { id: 'every15', label: 'Every 15 minutes', schedule: { mode: 'interval', intervalMinutes: 15 } },
        { id: 'hourly', label: 'Hourly', schedule: { mode: 'interval', intervalMinutes: 60 } },
        { id: 'daily', label: 'Daily', schedule: { mode: 'daily', times: ['06:00'] } },
        { id: 'custom', label: 'Custom (cron)', schedule: { mode: 'cron', cron: '0 */4 * * *' } },
      ],
      secretStorageAvailable: this.deps.secrets.available,
    };
  }

  // ---------------------------------------------------------------- read

  async list(providerType?: string) {
    return (await this.deps.repo.listIntegrations(providerType)).map(toIntegrationListItem);
  }

  async get(id: number) {
    return toIntegrationDto(await this.require(id));
  }

  async summary(id: number, days: number) {
    const summary = await this.deps.repo.getSummary(id, days);
    if (!summary) throw HttpError.notFound('Integration not found');
    return toSummaryDto(summary);
  }

  // ---------------------------------------------------------------- write

  async create(input: IntegrationInput, userId: number) {
    const write = await this.build(input, null);
    let sealed: string | null = null;
    if (input.secret) sealed = this.sealSecret(write.authType, input.secret);

    const saved = await this.deps.repo.saveIntegration(write, userId);
    if (sealed) await this.deps.repo.setSecret(saved.id, sealed, userId);
    await this.deps.repo.addAudit(saved.id, userId, 'created', { name: saved.name, providerType: saved.providerType, credentials: !!sealed });
    return toIntegrationDto(sealed ? (await this.deps.repo.getIntegration(saved.id))! : saved);
  }

  async update(id: number, input: IntegrationUpdate, userId: number) {
    const existing = await this.require(id);
    const write = await this.build(input, existing);
    write.expectedVersion = input.version;
    const saved = await this.deps.repo.saveIntegration(write, userId);
    await this.deps.repo.addAudit(id, userId, 'updated', {
      changed: changedSections(existing, saved),
      ...(write.clearSecret && existing.secretConfigured ? { credentialsCleared: 'authentication method changed' } : {}),
    });
    return toIntegrationDto(saved);
  }

  async setCredentials(id: number, secret: Record<string, unknown>, userId: number) {
    const existing = await this.require(id);
    const sealed = this.sealSecret(existing.authType, secret);
    await this.deps.repo.setSecret(id, sealed, userId);
    await this.deps.repo.addAudit(id, userId, 'secret_rotated', { authType: existing.authType, fields: Object.keys(secret) });
    return toIntegrationDto(await this.require(id));
  }

  async remove(id: number, userId: number) {
    const existing = await this.require(id);
    await this.deps.repo.deleteIntegration(id);
    await this.deps.repo.addAudit(null, userId, 'deleted', { integrationId: id, name: existing.name });
  }

  async resetCursor(id: number, profileId: number, userId: number) {
    const existing = await this.require(id);
    const profile = existing.profiles.find((p) => p.id === profileId);
    if (!profile) throw HttpError.notFound('Profile not found');
    await this.deps.repo.resetCursor(id, profileId);
    await this.deps.repo.addAudit(id, userId, 'cursor_reset', { profileId, profileName: profile.name });
  }

  // ---------------------------------------------------------------- connection test

  /** Tests the stored integration, optionally overridden by unsaved form values. */
  async testConnection(id: number, draft: Partial<IntegrationInput> | undefined, userId: number) {
    const existing = await this.require(id);
    const merged: IntegrationInput = {
      ...this.toInput(existing),
      ...stripUndefined(draft ?? {}),
    };
    const write = await this.build(merged, existing, { allowEmptyProfiles: true });
    const authChanged = write.authType !== existing.authType;
    const sealed = draft?.secret ? null : authChanged ? null : await this.deps.repo.getSealedSecret(id);
    const result = await this.runTest(id, existing, write, sealed, draft?.secret);
    await this.deps.repo.addAudit(id, userId, 'connection_tested', { ok: result.ok, draft: !!draft });
    return result;
  }

  /** Tests a new, unsaved integration (credentials from the form only). */
  async testDraft(input: IntegrationInput) {
    const write = await this.build(input, null, { allowEmptyProfiles: true });
    return this.runTest(0, null, write, null, input.secret);
  }

  // ---------------------------------------------------------------- sync control

  async syncNow(id: number, userId: number) {
    await this.require(id);
    const job = await this.enqueue({ integrationId: id, trigger: 'manual', requestedBy: userId });
    await this.deps.repo.addAudit(id, userId, 'sync_requested', { jobId: job.id });
    return job;
  }

  async retryJob(id: number, jobId: number, userId: number) {
    const job = await this.deps.repo.getJob(id, jobId);
    if (!job) throw HttpError.notFound('Job not found');
    if (!RETRYABLE_STATUSES.has(job.status)) {
      throw HttpError.conflict('Only failed, partially succeeded or cancelled jobs can be retried');
    }
    const retry = await this.enqueue({ integrationId: id, trigger: 'retry', requestedBy: userId, retryOfJobId: jobId, attempt: 1 });
    await this.deps.repo.addAudit(id, userId, 'job_retried', { jobId, retryJobId: retry.id });
    return retry;
  }

  async cancelJob(id: number, jobId: number, userId: number) {
    const job = await this.deps.repo.cancelJob(id, jobId);
    await this.deps.repo.addAudit(id, userId, 'job_cancelled', { jobId, status: job.status });
    return toJobDto(job);
  }

  async listJobs(id: number, filters: JobListFilters) {
    await this.require(id);
    const { rows, ...page } = await this.deps.repo.listJobs(id, filters);
    return { data: rows.map(toJobDto), ...page };
  }

  async getJob(id: number, jobId: number) {
    const job = await this.deps.repo.getJob(id, jobId);
    if (!job) throw HttpError.notFound('Job not found');
    return toJobDto(job);
  }

  async listJobErrors(id: number, jobId: number, stage: string | undefined, page: number, limit: number) {
    await this.getJob(id, jobId);
    const { rows, ...meta } = await this.deps.repo.listJobErrors(jobId, stage, page, limit);
    return { data: rows.map(toErrorDto), ...meta };
  }

  // ---------------------------------------------------------------- internals

  private async require(id: number): Promise<IntegrationRecord> {
    const record = await this.deps.repo.getIntegration(id);
    if (!record) throw HttpError.notFound('Integration not found');
    return record;
  }

  private async enqueue(request: Parameters<JobQueue['enqueue']>[0]) {
    try {
      const job = await this.deps.queue.enqueue(request);
      this.deps.onEnqueued?.();
      return toJobDto(job);
    } catch (err) {
      if (err instanceof QueueConflictError) throw HttpError.conflict(err.message);
      throw err;
    }
  }

  private sealSecret(authType: string, secret: Record<string, unknown>) {
    const factory = this.deps.authStrategies.get(authType);
    if (!factory) throw validationFailed({ authType: [`Unknown authentication method '${authType}'`] });
    const parsed = factory.secretSchema.safeParse(secret);
    if (!parsed.success) {
      const problems: FieldProblems = {};
      for (const issue of parsed.error.issues) (problems[['secret', ...issue.path.map(String)].join('.')] ??= []).push(issue.message);
      throw validationFailed(problems);
    }
    if (!this.deps.secrets.available) {
      throw new HttpError(503, 'Credential storage is not configured on the server (INTEGRATION_SECRET_KEY). Ask an operator to set it.');
    }
    return this.deps.secrets.seal(parsed.data as Record<string, unknown>);
  }

  /** Validates everything with the provider / auth / mapping schemas and returns normalised values. */
  private async build(
    input: IntegrationInput,
    existing: IntegrationRecord | null,
    options: { allowEmptyProfiles?: boolean } = {},
  ): Promise<IntegrationWrite> {
    const problems: FieldProblems = {};
    const provider = this.deps.providers.get(input.providerType);
    if (!provider) throw validationFailed({ providerType: [`Unknown provider '${input.providerType}'`] });
    if (existing && existing.providerType !== input.providerType) {
      throw validationFailed({ providerType: ['The provider of an existing integration cannot be changed'] });
    }

    const { connection, authSettings } = validateConnectionParts(this.deps.config, provider, input, problems);
    const schedule = scheduleSchema.safeParse(input.schedule);
    if (!schedule.success) for (const i of schedule.error.issues) (problems[['schedule', ...i.path.map(String)].join('.')] ??= []).push(i.message);
    const retryPolicy = retryPolicySchema.safeParse(input.retryPolicy);
    if (!retryPolicy.success) for (const i of retryPolicy.error.issues) (problems[['retryPolicy', ...i.path.map(String)].join('.')] ??= []).push(i.message);

    if (input.profiles.length === 0 && !options.allowEmptyProfiles) {
      (problems.profiles ??= []).push('Add at least one extraction profile (e.g. General Payments or SJO)');
    }
    const existingIds = new Set(existing?.profiles.map((p) => p.id) ?? []);
    const profiles: ProfileWrite[] = [];
    for (const [i, p] of input.profiles.entries()) {
      const module = await this.deps.resolveModule(p.moduleSlug);
      if (!module) (problems[`profiles.${i}.moduleSlug`] ??= []).push(`Unknown application '${p.moduleSlug}'`);
      if (p.id && !existingIds.has(p.id)) (problems[`profiles.${i}.id`] ??= []).push('Profile does not belong to this integration');
      const parts = validateProfileParts(provider, p, `profiles.${i}`, problems);
      if (module && parts) {
        profiles.push({
          id: p.id ?? null,
          moduleId: module.moduleId,
          module: { slug: module.slug, name: module.name, applicationCode: module.applicationCode, invoicePrefix: module.invoicePrefix },
          name: p.name,
          isActive: p.isActive,
          settings: parts.settings,
          keyFields: parts.keyFields,
          invoiceCodeTemplate: parts.invoiceCodeTemplate,
          fieldMapping: parts.fieldMapping as Record<string, unknown>,
          cancellationRule: parts.cancellationRule,
          defaultStatus: p.defaultStatus,
          initialFrom: p.initialFrom ?? null,
          sortOrder: i,
        });
      }
    }

    if (Object.keys(problems).length > 0 || !connection || !authSettings || !schedule.success || !retryPolicy.success) {
      throw validationFailed(problems);
    }

    const now = this.deps.now?.() ?? new Date();
    return {
      id: existing?.id ?? null,
      expectedVersion: existing?.version ?? null,
      providerType: input.providerType,
      name: input.name,
      description: input.description ?? null,
      environment: input.environment ?? null,
      sourceSystem: input.sourceSystem,
      isActive: input.isActive,
      connection,
      authType: input.authType,
      authSettings,
      clearSecret: !!existing && existing.authType !== input.authType,
      schedule: schedule.data,
      autoSyncEnabled: input.autoSyncEnabled,
      retryPolicy: retryPolicy.data,
      nextRunAt: input.autoSyncEnabled && input.isActive ? computeNextRun(schedule.data, now) : null,
      profiles,
    };
  }

  private async runTest(
    id: number,
    existing: IntegrationRecord | null,
    write: IntegrationWrite,
    sealed: string | null,
    secretOverride: Record<string, unknown> | undefined,
  ): Promise<ConnectionTestResult> {
    try {
      const config: IntegrationConfig = resolveIntegrationConfig(this.toRecord(id, existing, write), this.deps.config);
      const { provider, context } = this.deps.contexts.create(config, sealed, secretOverride);
      const signal = AbortSignal.timeout(this.deps.testTimeoutMs ?? 90_000);
      return await provider.createConnectionTester(context).test(config.profiles, signal);
    } catch (err) {
      return {
        ok: false,
        steps: [{ name: isIntegrationError(err) && err.code === 'CONFIG_INVALID' ? 'Configuration' : 'Authentication', ok: false, message: errorMessage(err), durationMs: 0 }],
      };
    }
  }

  /** Validated write model -> record shape used by resolveIntegrationConfig (for tests of unsaved values). */
  private toRecord(id: number, existing: IntegrationRecord | null, w: IntegrationWrite): IntegrationRecord {
    return {
      id,
      providerType: w.providerType,
      name: w.name,
      description: w.description,
      environment: w.environment,
      sourceSystem: w.sourceSystem,
      isActive: true,
      connection: w.connection,
      authType: w.authType,
      authSettings: w.authSettings,
      secretConfigured: !!existing?.secretConfigured,
      secretUpdatedAt: existing?.secretUpdatedAt ?? null,
      schedule: w.schedule,
      autoSyncEnabled: w.autoSyncEnabled,
      retryPolicy: w.retryPolicy,
      nextRunAt: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      lastJobId: null,
      version: existing?.version ?? 1,
      profiles: w.profiles.map((p, i) => {
        const stored = existing?.profiles.find((s) => s.id === p.id);
        return {
          id: p.id ?? -(i + 1),
          integrationId: id,
          moduleId: p.moduleId,
          moduleSlug: p.module.slug,
          moduleName: p.module.name,
          applicationCode: p.module.applicationCode,
          invoicePrefix: p.module.invoicePrefix,
          name: p.name,
          isActive: p.isActive,
          settings: p.settings,
          keyFields: p.keyFields,
          invoiceCodeTemplate: p.invoiceCodeTemplate,
          fieldMapping: p.fieldMapping,
          cancellationRule: p.cancellationRule,
          defaultStatus: p.defaultStatus,
          initialFrom: p.initialFrom,
          watermark: stored?.watermark ?? null,
          watermarkUpdatedAt: null,
          sortOrder: i,
        };
      }),
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: existing?.updatedAt ?? new Date(),
      updatedByName: null,
    };
  }

  private toInput(r: IntegrationRecord): IntegrationInput {
    return {
      providerType: r.providerType,
      name: r.name,
      description: r.description,
      environment: r.environment,
      sourceSystem: r.sourceSystem,
      isActive: r.isActive,
      connection: r.connection,
      authType: r.authType,
      authSettings: r.authSettings,
      schedule: r.schedule,
      autoSyncEnabled: r.autoSyncEnabled,
      retryPolicy: r.retryPolicy,
      profiles: r.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        moduleSlug: p.moduleSlug,
        isActive: p.isActive,
        settings: p.settings,
        keyFields: Array.isArray(p.keyFields) ? (p.keyFields as string[]) : [],
        invoiceCodeTemplate: p.invoiceCodeTemplate,
        fieldMapping: p.fieldMapping,
        cancellationRule: p.cancellationRule,
        defaultStatus: p.defaultStatus,
        initialFrom: p.initialFrom,
      })),
    };
  }
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Names of the configuration sections that changed (for the audit log - never values). */
const changedSections = (before: IntegrationRecord, after: IntegrationRecord) => {
  const sections: (keyof IntegrationRecord)[] = [
    'name', 'description', 'environment', 'sourceSystem', 'isActive', 'connection', 'authType', 'authSettings',
    'schedule', 'autoSyncEnabled', 'retryPolicy',
  ];
  const changed: string[] = sections.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const profileShape = (r: IntegrationRecord) =>
    JSON.stringify(r.profiles.map(({ watermark: _w, watermarkUpdatedAt: _u, ...rest }) => rest));
  if (profileShape(before) !== profileShape(after)) changed.push('profiles');
  return changed;
};
