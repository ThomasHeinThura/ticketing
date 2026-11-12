/** D-E: genuine workspace roles with workspace-wide project reach. */
export const WORKSPACE_PROJECT_SEE_ALL_ROLES = [
  "owner",
  "admin",
  "manager",
] as const;

export function workspaceRoleSeesAllProjects(role: string): boolean {
  return (WORKSPACE_PROJECT_SEE_ALL_ROLES as readonly string[]).includes(role);
}
