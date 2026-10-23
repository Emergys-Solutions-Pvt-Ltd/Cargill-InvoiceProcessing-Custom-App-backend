import { Router } from 'express';
import { listApplications, type AppModule } from './apps.repository.js';
import { listUsers } from '../users/users.repository.js';
import invoiceRoutes from '../invoices/invoices.app-routes.js';
import appConfigRoutes from '../app-config/app-config.routes.js';
import { requireAppAccess } from '../../middleware/auth.js';

const router = Router();

/** GET /api/apps - dashboard tiles, limited to the apps the user may open. */
router.get('/', async (req, res) => {
  const user = req.user!;
  res.json(await listApplications(user.role === 'Admin' ? undefined : user.assignedApps));
});

/**
 * GET /api/apps/:appId/users - active users an invoice of this app can be assigned to
 * (users granted the app, plus admins). Feeds the Invoice Details "Assigned User" dropdown.
 */
router.get('/:appId/users', requireAppAccess, async (_req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const [granted, admins] = await Promise.all([
    listUsers({ search: '', appFilter: appModule.applicationCode, roleFilter: 'ALL', page: 1, limit: 100 }),
    listUsers({ search: '', appFilter: 'ALL', roleFilter: 'Admin', page: 1, limit: 100 }),
  ]);
  const byId = new Map([...granted.data, ...admins.data].filter((u) => u.status === 'Active').map((u) => [u.id, u]));
  res.json(
    [...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ id: u.id, name: u.name, email: u.email })),
  );
});

router.use('/:appId/invoices', requireAppAccess, invoiceRoutes);
router.use('/:appId/config', requireAppAccess, appConfigRoutes);

export default router;
