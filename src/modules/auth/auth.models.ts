export type Role = 'Admin' | 'User';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Application codes the user may access (GP, sjo, rospbu). */
  assignedApps: string[];
}
