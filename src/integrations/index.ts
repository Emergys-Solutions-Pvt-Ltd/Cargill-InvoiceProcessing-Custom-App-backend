import { env } from '../config/env.js';
import { AuthStrategyRegistry } from './core/auth/auth-strategy.js';
import { builtInAuthStrategies } from './core/auth/strategies.js';
import { ProviderContextFactory } from './core/context-factory.js';
import { SyncEvents, attachLogSubscriber, attachMetricsSubscriber } from './core/events.js';
import type { ConfigDependencies } from './core/integration-config.js';
import { createLogger } from './core/logger.js';
import { ProviderRegistry } from './core/provider-registry.js';
import { AesGcmSecretStore, UnavailableSecretStore, type SecretStore } from './core/secrets/secret-store.js';
import { SyncScheduler } from './jobs/sync-scheduler.js';
import { SyncWorker } from './jobs/sync-worker.js';
import { PgJobQueue, PgSyncStore } from './persistence/pg-sync-store.js';
import { sapODataProvider } from './providers/sap-odata/sap-odata.provider.js';
import { SyncOrchestrator } from './sync/sync-orchestrator.js';

/**
 * Composition root of the integration framework (Dependency Injection by hand: every component
 * receives its collaborators; nothing below this file news up concrete dependencies).
 * To add a provider: implement IntegrationProvider and add one `.register(...)` line here.
 */
export const logger = createLogger({ component: 'integrations' });

export const providers = new ProviderRegistry().register(sapODataProvider);

export const authStrategies = new AuthStrategyRegistry();
for (const strategy of builtInAuthStrategies) authStrategies.register(strategy);

const createSecretStore = (): SecretStore => {
  if (!env.INTEGRATION_SECRET_KEY) {
    logger.warn('INTEGRATION_SECRET_KEY is not set: integration credentials cannot be stored');
    return new UnavailableSecretStore();
  }
  return new AesGcmSecretStore(env.INTEGRATION_SECRET_KEY, env.integrationPreviousKeys);
};

export const secrets = createSecretStore();

export const configDependencies: ConfigDependencies = {
  providers,
  authStrategies,
  urlPolicy: { allowedHosts: env.integrationAllowedHosts, allowLocalHttp: !env.isProduction },
};

export const events = new SyncEvents();
attachLogSubscriber(events, logger);
export const metrics = attachMetricsSubscriber(events);

export const syncStore = new PgSyncStore();
export const jobQueue = new PgJobQueue();
export const contextFactory = new ProviderContextFactory({ providers, authStrategies, secrets, logger });

const orchestrator = new SyncOrchestrator({ store: syncStore, contexts: contextFactory, config: configDependencies, events, logger });

export const worker = new SyncWorker(
  {
    queue: jobQueue,
    orchestrator,
    events,
    logger,
    retryPolicyOf: async (integrationId) => (await syncStore.loadIntegration(integrationId))?.retryPolicy ?? null,
  },
  { pollIntervalMs: env.SYNC_POLL_INTERVAL_SECONDS * 1000, staleSeconds: env.SYNC_JOB_STALE_SECONDS },
);

export const scheduler = new SyncScheduler(
  { queue: jobQueue, logger, onEnqueued: () => worker.wake() },
  { intervalMs: env.SYNC_SCHEDULER_INTERVAL_SECONDS * 1000, retentionDays: env.SYNC_HISTORY_RETENTION_DAYS },
);

/** Starts the scheduler + worker (API process with SYNC_WORKER_ENABLED, or the worker process). */
export const startBackgroundSync = () => {
  scheduler.start();
  worker.start();
};

export const stopBackgroundSync = async () => {
  await scheduler.stop();
  await worker.stop();
};
