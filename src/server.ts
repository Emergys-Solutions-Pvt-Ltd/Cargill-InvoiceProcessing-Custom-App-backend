import { env } from './config/env.js';
import { createApp } from './app.js';
import { closePool } from './db/pool.js';
import { startBackgroundSync, stopBackgroundSync } from './integrations/index.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`Cargill Custom Apps API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  // Invoice synchronization (SAP ...) runs in this process unless a dedicated worker is deployed
  if (env.SYNC_WORKER_ENABLED) startBackgroundSync();
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    // A running sync job is interrupted after its current request and put back in the queue
    await stopBackgroundSync().catch((err) => console.error('Error stopping background sync', err));
    await closePool().catch((err) => console.error('Error closing DB pool', err));
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 25_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
