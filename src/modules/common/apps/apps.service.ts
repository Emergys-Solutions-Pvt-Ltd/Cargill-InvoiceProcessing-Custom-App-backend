import type { AuthUser } from '../../auth/auth.models.js';
import { listUserAccounts } from '../../auth/users/users.service.js';
import { findModuleBySlug, listApplications } from './apps.dal.js';
import type { AppModule } from './apps.models.js';

// ---- Business rules of the application tiles and per-app user lists ----

/** Dashboard tiles: every app for admins, otherwise only the apps the user was granted. */
export const listVisibleApplications = (user: AuthUser) =>
  listApplications(user.role === 'Admin' ? undefined : user.assignedApps);

/**
 * Active users an invoice of this app can be assigned to (users granted the app, plus admins),
 * sorted by name. Feeds the "Assign To" / "Assigned User" dropdowns.
 */
export const listAssignableUsers = async (appModule: AppModule) => {
  const [granted, admins] = await Promise.all([
    listUserAccounts({ search: '', appFilter: appModule.applicationCode, roleFilter: 'ALL', page: 1, limit: 100 }),
    listUserAccounts({ search: '', appFilter: 'ALL', roleFilter: 'Admin', page: 1, limit: 100 }),
  ]);
  const byId = new Map([...granted.data, ...admins.data].filter((u) => u.status === 'Active').map((u) => [u.id, u]));
  return [...byId.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
};

/** The app module behind a route's :appId slug, or null. */
export const findAppModule = (slug: string) => findModuleBySlug(slug);
