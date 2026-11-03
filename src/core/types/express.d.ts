import type { AuthUser } from '../../modules/auth/auth.models.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
