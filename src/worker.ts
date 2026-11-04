import { closePool } from './core/db/pool.js';
import { logger, startBackgroundSync, stopBackgroundSync } from './modules/common/integrations/engine/index.js';
import { startMailboxPolling, stopMailboxPolling } from './modules/common/mailbox/index.js';

/**
 * Dedicated synchronization worker (scheduler + job worker, no HTTP):
 *   npm run worker            (production build)
 *   npm run dev:worker        (watch mode)
 * Deploy it as its own container and set SYNC_WORKER_ENABLED=false on the API containers to keep
 * long SAP extractions off the API instances. Any number of workers may run: jobs are claimed with
 * FOR UPDATE SKIP LOCKED and an integration never has two active jobs.
 * Also polls the registered mailboxes when MAILBOX_POLLING_ENABLED (run polling in one process only).
 */
startBackgroundSync();
startMailboxPolling();
logger.info('Synchronization worker process started', { pid: process.pid });

const shutdown = async (signal: string) => {
  logger.info('Worker shutting down', { signal });
  setTimeout(() => process.exit(1), 25_000).unref();
  await stopBackgroundSync().catch((err) => logger.error('Error stopping background sync', { error: String(err) }));
  await stopMailboxPolling().catch((err) => logger.error('Error stopping mailbox polling', { error: String(err) }));
  await closePool().catch(() => {});
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
