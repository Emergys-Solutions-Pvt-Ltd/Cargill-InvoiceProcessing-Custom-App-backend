import { Router } from 'express';
import { requireAppAccess } from '../../auth/auth.middleware.js';
import appConfigRoutes from '../app-config/app-config.controller.js';
import appInvoicesRoutes from '../invoices/app-invoices.controller.js';
import invoiceRoutes from '../invoices/invoices.controller.js';
import type { AppModule } from './apps.models.js';
import { listAssignableUsers, listVisibleApplications } from './apps.service.js';

// REST controller - mounted at /api/apps
const router = Router();

/** GET /api/apps - dashboard tiles, limited to the apps the user may open. */
router.get('/', async (req, res) => {
  res.json(await listVisibleApplications(req.user!));
});

/** GET /api/apps/:appId/users - active users an invoice of this app can be assigned to (users granted the app, plus admins). */
router.get('/:appId/users', requireAppAccess, async (_req, res) => {
  res.json(await listAssignableUsers(res.locals.appModule as AppModule));
});

// List / create, then one invoice (/:invoiceId...) - invoices live in the app's own tables
router.use('/:appId/invoices', requireAppAccess, appInvoicesRoutes, invoiceRoutes);
router.use('/:appId/config', requireAppAccess, appConfigRoutes);

export default router;
