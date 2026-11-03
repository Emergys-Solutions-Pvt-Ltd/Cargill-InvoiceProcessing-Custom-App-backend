import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.middleware.js';
import { paginationQuery } from '../../../core/http/pagination.js';
import { parse } from '../../../core/http/validate.js';
import {
  changeUserStatus,
  createUserAccount,
  deleteUserAccount,
  getUserAccount,
  listUserAccounts,
  updateUserAccount,
} from './users.service.js';

// REST controller - mounted at /api/users: Settings / User Access Management screen (admin only)
const router = Router();
router.use(requireAdmin);

const roleSchema = z
  .string()
  .transform((r) => r.toLowerCase())
  .pipe(z.enum(['admin', 'user']))
  .transform((r) => (r === 'admin' ? 'Admin' : 'User') as 'Admin' | 'User');

const listQuery = z.object({
  search: z.string().trim().default(''),
  appFilter: z.string().trim().default('ALL'),
  roleFilter: z.string().trim().default('ALL'),
  ...paginationQuery,
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(255).transform((e) => e.toLowerCase()),
    username: z.string().trim().min(1).max(150).optional(),
    role: roleSchema.default('User'),
    authProvider: z.enum(['LOCAL', 'AD']).default('AD'),
    password: z.string().min(8).max(128).optional(),
    assignedApps: z.array(z.string()).default([]),
  })
  .refine((u) => u.authProvider === 'AD' || !!u.password, {
    message: 'password is required for LOCAL users',
    path: ['password'],
  });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(255).transform((e) => e.toLowerCase()).optional(),
    role: roleSchema.optional(),
    status: z.enum(['Active', 'Suspended']).optional(),
    assignedApps: z.array(z.string()).optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'Nothing to update' });

/** GET /api/users?search=&appFilter=&roleFilter=&page=&limit= */
router.get('/', async (req, res) => {
  res.json(await listUserAccounts(parse(listQuery, req.query)));
});

router.get('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(await getUserAccount(id));
});

/** POST /api/users - "Add User" modal (usp_user_create rejects unknown apps / taken emails) */
router.post('/', async (req, res) => {
  const user = await createUserAccount(parse(createSchema, req.body));
  res.status(201).json({ message: 'User created successfully', data: user });
});

/** PUT /api/users/:id - edit name / email / role / status / assigned apps */
router.put('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { assignedApps, ...body } = parse(updateSchema, req.body);
  const user = await updateUserAccount(req.user!.id, id, { ...body, appCodes: assignedApps });
  res.json({ message: 'User updated successfully', data: user });
});

/** PATCH /api/users/:id/status - Active / Suspended toggle; omitting status flips it. */
router.patch('/:id/status', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { status } = parse(z.object({ status: z.enum(['Active', 'Suspended']).optional() }), req.body ?? {});
  const result = await changeUserStatus(req.user!.id, id, status);
  res.json({ message: `User status for ${result.user.name} changed to ${result.status}`, data: result.user });
});

/** DELETE /api/users/:id - remove a user (usp_user_delete keeps their invoice / team history) */
router.delete('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await deleteUserAccount(req.user!.id, id);
  res.json({ message: `User ${existing.name} deleted`, data: { id } });
});

export default router;
