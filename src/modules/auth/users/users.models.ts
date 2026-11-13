import type { Role } from '../auth.models.js';

export type UserStatus = 'Active' | 'Suspended';

export interface UserListItem {
  id: string;
  username: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  authProvider: 'LOCAL' | 'AD';
  assignedApps: string[];
}

export interface LoginUserRecord extends UserListItem {
  passwordHash: string | null;
}

export interface UserListFilters {
  search: string;
  appFilter: string;
  roleFilter: string;
  page: number;
  limit: number;
}

export interface CreateUserInput {
  username: string;
  name: string;
  email: string;
  role: Role;
  authProvider: 'LOCAL' | 'AD';
  passwordHash: string | null;
  appCodes: string[];
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: Role;
  status?: UserStatus;
  /** Replaces the assigned applications when provided. */
  appCodes?: string[];
}
