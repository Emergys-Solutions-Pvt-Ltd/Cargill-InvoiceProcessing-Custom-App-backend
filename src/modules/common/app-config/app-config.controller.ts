import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../auth/auth.middleware.js';
import type { AppModule } from '../apps/apps.models.js';
import { paginationQuery } from '../../../core/http/pagination.js';
import { parse } from '../../../core/http/validate.js';
import { addTeamMember, getAppConfiguration, removeTeamMembers, saveAppSettings } from './app-config.service.js';

// REST controller - mounted at /api/apps/:appId/config - Admin Configuration screen (admin only, like the UI route)
const router = Router();
router.use(requireAdmin);

const listQuery = z.object({
  team: z.string().trim().default('ALL'),
  search: z.string().trim().default(''),
  ...paginationQuery,
});

const settingsSchema = z
  .object({
    enableNotifications: z.boolean().optional(),
    maxInvoicesLimit: z.coerce.number().int().min(0).max(100000).optional(),
  })
  .refine((s) => Object.keys(s).length > 0, { message: 'Nothing to update' });

const memberSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(255).transform((e) => e.toLowerCase()),
  alias: z.string().trim().max(100).optional(),
  team: z.string().trim().min(1).max(100).default('Reception Team'),
});

/** GET /api/apps/:appId/config?team=&search=&page=&limit= */
router.get('/', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  res.json(await getAppConfiguration(appModule, parse(listQuery, req.query)));
});

/** PUT /api/apps/:appId/config/settings - "Save Changes" */
router.put('/settings', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const body = parse(settingsSchema, req.body);
  const settings = await saveAppSettings(appModule, body, req.user!.id);
  res.json({ message: 'Settings saved', settings });
});

/** POST /api/apps/:appId/config/members - "Add Member" modal */
router.post('/members', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const body = parse(memberSchema, req.body);
  const member = await addTeamMember(appModule, body);
  res.status(201).json({ message: 'Member added', data: member });
});

/** DELETE /api/apps/:appId/config/members  { ids: [..] } - "Remove Selected" */
router.delete('/members', async (req, res) => {
  const appModule = res.locals.appModule as AppModule;
  const { ids } = parse(z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(500) }), req.body);
  const removed = await removeTeamMembers(appModule, ids);
  res.json({ message: `${removed} member(s) removed`, count: removed });
});

export default router;
