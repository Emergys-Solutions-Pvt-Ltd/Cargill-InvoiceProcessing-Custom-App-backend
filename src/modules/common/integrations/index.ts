import { env } from '../../../core/config/env.js';
import {
  authStrategies,
  configDependencies,
  contextFactory,
  jobQueue,
  metrics,
  providers,
  secrets,
  worker,
} from './engine/index.js';
import { findModuleBySlug } from '../apps/apps.dal.js';
import * as repo from './integrations.dal.js';
import { createIntegrationsRouter } from './integrations.controller.js';
import { IntegrationService } from './integrations.service.js';

/** Wires the Settings > SAP Configuration API to the integration framework. */
export const integrationService = new IntegrationService({
  repo,
  providers,
  authStrategies,
  secrets,
  contexts: contextFactory,
  config: configDependencies,
  queue: jobQueue,
  resolveModule: findModuleBySlug,
  // A worker in this process picks the job up immediately; a separate worker finds it on its next poll
  onEnqueued: () => worker.wake(),
});

export default createIntegrationsRouter(integrationService, () => ({
  workerEnabled: env.SYNC_WORKER_ENABLED,
  workerId: env.SYNC_WORKER_ENABLED ? worker.workerId : null,
  metrics,
}));
