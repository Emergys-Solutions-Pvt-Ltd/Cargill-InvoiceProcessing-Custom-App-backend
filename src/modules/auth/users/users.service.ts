import bcrypt from 'bcryptjs';
import { HttpError } from '../../../core/http/http-error.js';
import { createUser, deleteUser, findActiveAuthUserById, findUserById, listUsers, updateUser } from './users.dal.js';
import type { UpdateUserInput, UserListFilters, UserListItem, UserStatus } from './users.models.js';

// ---- Business rules of User Access Management (Settings > Users) ----

export const listUserAccounts = (filters: UserListFilters) => listUsers(filters);

export const getUserAccount = async (id: number): Promise<UserListItem> => {
  const user = await findUserById(id);
  if (!user) throw HttpError.notFound('User not found');
  return user;
};

/** usp_user_create rejects unknown apps / taken emails; local passwords are stored as bcrypt hashes. */
export const createUserAccount = async (input: {
  name: string;
  email: string;
  username?: string;
  role: 'Admin' | 'User';
  authProvider: 'LOCAL' | 'AD';
  password?: string;
  assignedApps: string[];
}) =>
  createUser({
    username: input.username ?? input.email,
    name: input.name,
    email: input.email,
    role: input.role,
    authProvider: input.authProvider,
    passwordHash: input.password ? await bcrypt.hash(input.password, 12) : null,
    appCodes: input.assignedApps,
  });

/** Admins cannot suspend or demote themselves. */
export const updateUserAccount = async (actorId: number, id: number, input: UpdateUserInput) => {
  if (id === actorId && (input.status === 'Suspended' || input.role === 'User')) {
    throw HttpError.badRequest('You cannot suspend or demote your own account');
  }
  return updateUser(id, input);
};

/** Active / Suspended toggle; omitting status flips it. */
export const changeUserStatus = async (actorId: number, id: number, status?: UserStatus) => {
  const existing = await getUserAccount(id);
  const nextStatus = status ?? (existing.status === 'Active' ? 'Suspended' : 'Active');
  if (id === actorId && nextStatus === 'Suspended') {
    throw HttpError.badRequest('You cannot suspend your own account');
  }
  return { user: await updateUser(id, { status: nextStatus }), status: nextStatus };
};

/** usp_user_delete keeps the user's invoice / team history. */
export const deleteUserAccount = async (actorId: number, id: number) => {
  const existing = await getUserAccount(id);
  await deleteUser(id, actorId);
  return existing;
};

/** The active user behind a token (reloaded per request, so suspensions apply immediately). */
export const findActiveAuthUser = (id: number) => findActiveAuthUserById(id);
