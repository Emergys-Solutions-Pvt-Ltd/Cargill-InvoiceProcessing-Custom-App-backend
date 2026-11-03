import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './core/config/env.js';
import { pool } from './core/db/pool.js';
import { errorHandler, notFoundHandler } from './core/http/error-handler.js';
import docsRoutes from './core/docs/docs.controller.js';
import {
  appsController,
  attachmentStorage,
  authController,
  authenticate,
  ccppController,
  filesController,
  integrationsController,
  lookupsController,
  masterDataController,
  registerAppModules,
  requireAdmin,
  requireAppAccess,
  usersController,
} from './modules/index.js';

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
  // GPP / SJO / ROSPBU fields and rules on the common invoice endpoints
  registerAppModules();

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
  app.use('/api/auth', authController);
  app.use('/api/files', filesController);

  // Authenticated
  app.use('/api/apps', authenticate, appsController);
  // GPP: /api/apps/:appId/invoices/:invoiceId/ccpp (invoice routes themselves are under appsController)
  app.use('/api/apps/:appId/invoices', authenticate, requireAppAccess, ccppController);
  app.use('/api/users', authenticate, usersController);
  app.use('/api/lookups', authenticate, lookupsController);
  app.use('/api/master-data', authenticate, masterDataController);
  // Settings > SAP Configuration: viewing and changing integrations is admin only
  app.use('/api/integrations', authenticate, requireAdmin, integrationsController);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
