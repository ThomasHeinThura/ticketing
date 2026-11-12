/** D-E, Thomas 12 Nov 2026: only validated system workspace roles use this rule. */
export const WORKSPACE_PROJECT_SEE_ALL_ROLES = [
  "owner",
  "admin",
  "manager",
] as const;
export function workspaceRoleSeesAllProjects(role: string): boolean {
  return (WORKSPACE_PROJECT_SEE_ALL_ROLES as readonly string[]).includes(role);
}
