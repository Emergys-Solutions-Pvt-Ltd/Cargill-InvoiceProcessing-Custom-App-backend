import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../core/http/validate.js';
import { authenticate } from './auth.middleware.js';
import { currentUserProfile, login } from './auth.service.js';

// REST controller - mounted at /api/auth
const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  isAD: z.boolean().optional().default(false),
});

/** POST /api/auth/login -> user profile + JWT (shape expected by AuthContext). */
router.post('/login', async (req, res) => {
  const { username, password, isAD } = parse(loginSchema, req.body);
  res.json(await login(username, password, isAD));
});

/** GET /api/auth/me -> current user, lets the UI refresh permissions without re-login. */
router.get('/me', authenticate, (req, res) => {
  res.json(currentUserProfile(req.user!));
});

export default router;
