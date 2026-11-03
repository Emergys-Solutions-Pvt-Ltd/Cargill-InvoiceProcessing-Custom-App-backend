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

export interface MemberFilters {
  team: string;
  search: string;
  page: number;
  limit: number;
}
