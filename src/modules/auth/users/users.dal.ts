import { callFunction, callFunctionSingle, toPageMeta, type PageColumns } from '../../../core/db/procedures.js';
import type { AuthUser, Role } from '../auth.models.js';
import type { Paginated } from '../../../core/http/pagination.js';
import { type UserStatus, type UserListItem, type LoginUserRecord, type UserListFilters, type CreateUserInput, type UpdateUserInput } from './users.models.js';

// app_auth.udt_user_result (+ password_hash for udt_user_login_result, + paging for udt_user_list_result)
interface UserResult {
  id: number;
  username: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  auth_provider: 'LOCAL' | 'AD';
  assigned_apps: string | null;
  password_hash?: string | null;
}

const toUser = (row: UserResult): UserListItem => ({
  id: row.id,
  username: row.username,
  name: row.name,
  email: row.email,
  role: row.role,
  status: row.status,
  authProvider: row.auth_provider,
  assignedApps: row.assigned_apps ? row.assigned_apps.split(',') : [],
});

export const findActiveAuthUserById = async (id: number): Promise<AuthUser | null> => {
  if (!Number.isInteger(id)) return null;
  const [row] = await callFunction<UserResult>('app_auth.usp_user_get_by_id', { p_user_id: id, p_active_only: true });
  if (!row) return null;
  const { email, name, role, assignedApps } = toUser(row);
  return { id: row.id, email, name, role, assignedApps };
};

export const findUserById = async (id: number): Promise<UserListItem | null> => {
  const [row] = await callFunction<UserResult>('app_auth.usp_user_get_by_id', { p_user_id: id, p_active_only: false });
  return row ? toUser(row) : null;
};

/** Login accepts either the short username ("admin") or the full email, case-insensitively. */
export const findUserForLogin = async (login: string): Promise<LoginUserRecord | null> => {
  const [row] = await callFunction<UserResult>('app_auth.usp_user_get_for_login', { p_login: login });
  return row ? { ...toUser(row), passwordHash: row.password_hash ?? null } : null;
};

export const touchLastLogin = async (id: number) => {
  await callFunction('app_auth.usp_user_touch_last_login', { p_user_id: id });
};

export const listUsers = async (f: UserListFilters): Promise<Paginated<UserListItem>> => {
  const rows = await callFunction<UserResult & PageColumns>('app_auth.usp_user_list', {
    p_search: f.search || null,
    p_app_code: f.appFilter,
    p_role: f.roleFilter,
    p_page: f.page,
    p_page_size: f.limit,
  });
  return { data: rows.map(toUser), ...toPageMeta(rows[0], f.limit) };
};

/** Raises CA400 (unknown app code) / CA409 (email or username taken). */
export const createUser = async (input: CreateUserInput): Promise<UserListItem> =>
  toUser(
    await callFunctionSingle<UserResult>('app_auth.usp_user_create', {
      p_username: input.username,
      p_name: input.name,
      p_email: input.email,
      p_role: input.role,
      p_auth_provider: input.authProvider,
      p_password_hash: input.passwordHash,
      p_app_codes: input.appCodes,
    }),
  );

/** Raises CA404 when the user does not exist, CA400 for an unknown app code, CA409 for a taken email. */
export const updateUser = async (id: number, input: UpdateUserInput): Promise<UserListItem> =>
  toUser(
    await callFunctionSingle<UserResult>('app_auth.usp_user_update', {
      p_user_id: id,
      p_name: input.name ?? null,
      p_email: input.email ?? null,
      p_role: input.role ?? null,
      p_status: input.status ?? null,
      p_app_codes: input.appCodes ?? null,
    }),
  );

/** Raises CA400 when deleting your own account, CA404 when the user does not exist. */
export const deleteUser = async (id: number, deletedBy: number): Promise<void> => {
  await callFunctionSingle('app_auth.usp_user_delete', { p_user_id: id, p_deleted_by: deletedBy });
};
