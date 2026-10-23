import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { parse } from '../../utils/validate.js';
import { findUserForLogin, touchLastLogin } from '../users/users.repository.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  isAD: z.boolean().optional().default(false),
});

// Compared against when the user does not exist so response timing does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

/** POST /api/auth/login -> user profile + JWT (shape expected by AuthContext). */
router.post('/login', async (req, res) => {
  const { username, password, isAD } = parse(loginSchema, req.body);

  if (isAD) {
    throw new HttpError(501, 'Azure AD sign-in is not configured on this server');
  }

  const user = await findUserForLogin(username);
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.passwordHash || !passwordOk) throw HttpError.unauthorized('Invalid credentials');
  if (user.status !== 'Active') throw HttpError.forbidden('User account is suspended');

  await touchLastLogin(user.id);

  const token = jwt.sign({ sub: String(user.id), role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

  res.json({
    id: user.id,
    username: user.email,
    name: user.name,
    email: user.email,
    role: user.role.toLowerCase(),
    assignedApps: user.assignedApps,
    token,
  });
});

/** GET /api/auth/me -> current user, lets the UI refresh permissions without re-login. */
router.get('/me', authenticate, (req, res) => {
  const user = req.user!;
  res.json({ ...user, username: user.email, role: user.role.toLowerCase() });
});

export default router;
