import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { paginationQuery } from '../../utils/pagination.js';
import { parse } from '../../utils/validate.js';
import { createUser, deleteUser, findUserById, listUsers, updateUser } from './users.repository.js';

// Settings / User Access Management screen (admin only)
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
  const query = parse(listQuery, req.query);
  res.json(await listUsers(query));
});

router.get('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const user = await findUserById(id);
  if (!user) throw HttpError.notFound('User not found');
  res.json(user);
});

/** POST /api/users - "Add User" modal (usp_User_Create rejects unknown apps / taken emails) */
router.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const user = await createUser({
    username: body.username ?? body.email,
    name: body.name,
    email: body.email,
    role: body.role,
    authProvider: body.authProvider,
    passwordHash: body.password ? await bcrypt.hash(body.password, 12) : null,
    appCodes: body.assignedApps,
  });
  res.status(201).json({ message: 'User created successfully', data: user });
});

/** PUT /api/users/:id - edit name / email / role / status / assigned apps */
router.put('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { assignedApps, ...body } = parse(updateSchema, req.body);
  if (id === req.user!.id && (body.status === 'Suspended' || body.role === 'User')) {
    throw HttpError.badRequest('You cannot suspend or demote your own account');
  }
  const user = await updateUser(id, { ...body, appCodes: assignedApps });
  res.json({ message: 'User updated successfully', data: user });
});

/** PATCH /api/users/:id/status - Active / Suspended toggle; omitting status flips it. */
router.patch('/:id/status', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { status } = parse(z.object({ status: z.enum(['Active', 'Suspended']).optional() }), req.body ?? {});
  const existing = await findUserById(id);
  if (!existing) throw HttpError.notFound('User not found');

  const nextStatus = status ?? (existing.status === 'Active' ? 'Suspended' : 'Active');
  if (id === req.user!.id && nextStatus === 'Suspended') {
    throw HttpError.badRequest('You cannot suspend your own account');
  }
  const user = await updateUser(id, { status: nextStatus });
  res.json({ message: `User status for ${user.name} changed to ${nextStatus}`, data: user });
});

/** DELETE /api/users/:id - remove a user (usp_user_delete keeps their invoice / team history) */
router.delete('/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const existing = await findUserById(id);
  if (!existing) throw HttpError.notFound('User not found');
  await deleteUser(id, req.user!.id);
  res.json({ message: `User ${existing.name} deleted`, data: { id } });
});

export default router;
