import { env } from '../../config/env.js';
import {
  authStrategies,
  configDependencies,
  contextFactory,
  jobQueue,
  metrics,
  providers,
  secrets,
  worker,
} from '../../integrations/index.js';
import { findModuleBySlug } from '../apps/apps.repository.js';
import * as repo from './integrations.repository.js';
import { createIntegrationsRouter } from './integrations.routes.js';
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
