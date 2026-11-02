import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { authenticate, requireAdmin } from './middleware/auth.js';
import { attachmentStorage } from './storage/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import appsRoutes from './modules/apps/apps.routes.js';
import invoicesRoutes from './modules/invoices/invoices.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import lookupsRoutes from './modules/lookups/lookups.routes.js';
import filesRoutes from './modules/files/files.routes.js';
import docsRoutes from './docs/docs.routes.js';
import masterDataRoutes from './modules/master-data/master-data.routes.js';
import integrationsRoutes from './modules/integrations/index.js';

/** Storage check (S3 HeadBucket / local write access), cached so health probes do not hammer S3. */
const STORAGE_HEALTH_TTL_MS = 30_000;
let storageCheck: { at: number; result: Awaited<ReturnType<typeof attachmentStorage.health>> } | null = null;
const storageHealth = async () => {
  if (!storageCheck || Date.now() - storageCheck.at > STORAGE_HEALTH_TTL_MS) {
    const result = await attachmentStorage.health();
    if (result.status === 'down') console.error(`Attachment storage check failed: ${result.error}`);
    storageCheck = { at: Date.now(), result };
  }
  return storageCheck.result;
};

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  app.get('/api/health', async (_req, res) => {
    const [database, storage] = await Promise.all([
      pool.query('SELECT 1').then(() => 'up' as const, () => 'down' as const),
      storageHealth(),
    ]);
    const ok = database === 'up' && storage.status === 'up';
    // Storage errors stay in the server log (they can name buckets / IAM details)
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      database,
      storage: { provider: storage.provider, status: storage.status },
    });
  });

  // Public
  app.use('/api/docs', docsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/files', filesRoutes);

  // Authenticated
  app.use('/api/apps', authenticate, appsRoutes);
  app.use('/api/invoices', authenticate, invoicesRoutes);
  app.use('/api/users', authenticate, usersRoutes);
  app.use('/api/lookups', authenticate, lookupsRoutes);
  app.use('/api/master-data', authenticate, masterDataRoutes);
  // Settings > SAP Configuration: viewing and changing integrations is admin only
  app.use('/api/integrations', authenticate, requireAdmin, integrationsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
