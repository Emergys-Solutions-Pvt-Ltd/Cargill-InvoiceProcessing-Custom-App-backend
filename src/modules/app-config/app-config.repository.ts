import { callFunction, callFunctionSingle, toPageMeta, type PageColumns } from '../../db/procedures.js';

export interface AppSettings {
  enableNotifications: boolean;
  maxInvoicesLimit: number;
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  alias: string;
  team: string;
}

// app.udt_app_settings_result / app.udt_team_member_result / app.udt_lookup_value_result
interface AppSettingsResult {
  module_id: number;
  enable_notifications: boolean;
  max_invoices_limit: number;
}

const toSettings = (r: AppSettingsResult): AppSettings => ({
  enableNotifications: r.enable_notifications,
  maxInvoicesLimit: r.max_invoices_limit,
});

const toMember = ({ id, name, email, alias, team }: TeamMember): TeamMember => ({ id, name, email, alias, team });

export const getSettings = async (moduleId: number): Promise<AppSettings> =>
  toSettings(await callFunctionSingle<AppSettingsResult>('usp_app_settings_get', { p_module_id: moduleId }));

/** Fields left undefined keep their current value. */
export const upsertSettings = async (moduleId: number, settings: Partial<AppSettings>, userId: number) =>
  toSettings(
    await callFunctionSingle<AppSettingsResult>('usp_app_settings_save', {
      p_module_id: moduleId,
      p_enable_notifications: settings.enableNotifications ?? null,
      p_max_invoices_limit: settings.maxInvoicesLimit ?? null,
      p_updated_by: userId,
    }),
  );

export const listTeams = async (): Promise<string[]> =>
  (await callFunction<{ name: string }>('usp_team_list')).map((t) => t.name);

export interface MemberFilters {
  team: string;
  search: string;
  page: number;
  limit: number;
}

export const listMembers = async (moduleId: number, f: MemberFilters) => {
  const rows = await callFunction<TeamMember & PageColumns>('usp_team_member_list', {
    p_module_id: moduleId,
    p_team: f.team,
    p_search: f.search || null,
    p_page: f.page,
    p_page_size: f.limit,
  });
  return { users: rows.map(toMember), ...toPageMeta(rows[0], f.limit) };
};

/** Raises CA400 (unknown team) / CA409 (email already a member of this module). */
export const addMember = async (
  moduleId: number,
  member: { name: string; email: string; alias?: string; team: string },
): Promise<TeamMember> =>
  toMember(
    await callFunctionSingle<TeamMember>('usp_team_member_add', {
      p_module_id: moduleId,
      p_name: member.name,
      p_email: member.email,
      p_alias: member.alias ?? null,
      p_team: member.team,
    }),
  );

/** Ids belonging to another module are ignored; returns the number removed. */
export const removeMembers = async (moduleId: number, ids: number[]): Promise<number> =>
  (
    await callFunctionSingle<{ rows_affected: number }>('usp_team_member_remove', {
      p_module_id: moduleId,
      p_member_ids: ids,
    })
  ).rows_affected;
