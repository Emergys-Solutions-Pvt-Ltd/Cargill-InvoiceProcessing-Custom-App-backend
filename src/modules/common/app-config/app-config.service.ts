import type { AppModule } from '../apps/apps.models.js';
import { addMember, getSettings, listMembers, listTeams, removeMembers, upsertSettings } from './app-config.dal.js';
import type { AppSettings, MemberFilters } from './app-config.models.js';

// ---- Business rules of the per-app Admin Configuration screen (settings, team members) ----

/** Settings, the team list and one page of members of the app's module. */
export const getAppConfiguration = async (appModule: AppModule, filters: MemberFilters) => {
  const [settings, teams, members] = await Promise.all([
    getSettings(appModule.moduleId),
    listTeams(),
    listMembers(appModule.moduleId, filters),
  ]);
  return { appId: appModule.slug, settings, teams, ...members };
};

export const saveAppSettings = (appModule: AppModule, settings: Partial<AppSettings>, userId: number) =>
  upsertSettings(appModule.moduleId, settings, userId);

/** usp_team_member_add defaults the alias and rejects unknown teams / duplicate emails. */
export const addTeamMember = (appModule: AppModule, member: { name: string; email: string; alias?: string; team: string }) =>
  addMember(appModule.moduleId, member);

export const removeTeamMembers = (appModule: AppModule, ids: number[]) => removeMembers(appModule.moduleId, ids);
