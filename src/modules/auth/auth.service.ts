import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../core/config/env.js';
import { HttpError } from '../../core/http/http-error.js';
import type { AuthUser } from './auth.models.js';
import { findUserForLogin, touchLastLogin } from './users/users.dal.js';

// ---- Business rules of sign-in ----

// Compared against when the user does not exist so response timing does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

/** Checks the credentials and issues a JWT; profile shape expected by the UI's AuthContext. */
export const login = async (username: string, password: string, isAD: boolean) => {
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

  return {
    id: user.id,
    username: user.email,
    name: user.name,
    email: user.email,
    role: user.role.toLowerCase(),
    assignedApps: user.assignedApps,
    token,
  };
};

/** The signed-in user as the UI expects it (lower-case role, username = email). */
export const currentUserProfile = (user: AuthUser) => ({ ...user, username: user.email, role: user.role.toLowerCase() });
