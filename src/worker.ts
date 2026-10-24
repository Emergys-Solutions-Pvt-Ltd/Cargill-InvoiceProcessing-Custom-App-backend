import { closePool } from './db/pool.js';
import { logger, startBackgroundSync, stopBackgroundSync } from './integrations/index.js';

/**
 * Dedicated synchronization worker (scheduler + job worker, no HTTP):
 *   npm run worker            (production build)
 *   npm run dev:worker        (watch mode)
 * Deploy it as its own container and set SYNC_WORKER_ENABLED=false on the API containers to keep
 * long SAP extractions off the API instances. Any number of workers may run: jobs are claimed with
 * FOR UPDATE SKIP LOCKED and an integration never has two active jobs.
 */
startBackgroundSync();
logger.info('Synchronization worker process started', { pid: process.pid });

const shutdown = async (signal: string) => {
  logger.info('Worker shutting down', { signal });
  setTimeout(() => process.exit(1), 25_000).unref();
  await stopBackgroundSync().catch((err) => logger.error('Error stopping background sync', { error: String(err) }));
  await closePool().catch(() => {});
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
