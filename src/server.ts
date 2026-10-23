import { env } from './config/env.js';
import { createApp } from './app.js';
import { closePool } from './db/pool.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`Cargill Custom Apps API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await closePool().catch((err) => console.error('Error closing DB pool', err));
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
