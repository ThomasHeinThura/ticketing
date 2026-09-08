/**
 * The 16 capability checks the client's `useWorkspacePermission` hook fans
 * out, one HTTP round trip each, to the better-auth `organization()`
 * plugin's `has-permission` route
 * (`apps/web/src/hooks/use-workspace-permission.ts:15-32`). `GET
 * /api/capabilities` (S2, issue #6, retrofit plan matrix row 15) computes
 * the same 16 keys server-side, in one round trip, over
 * `hasWorkspacePermission`
 * (`apps/api/src/utils/require-workspace-permission.ts:87`) -- the exact
 * TaskDesk-native check every other authenticated route already goes
 * through.
 *
 * This is a deliberate, server-side DUPLICATE of the client map, not a
 * shared import -- `apps/web` and `apps/api` are different applications on
 * opposite sides of the wire. Keep the two in sync by hand: a key added to
 * one side without the other silently breaks the client's fan-out or
 * leaves this endpoint short a capability. The permission-map SHAPE
 * (`Record<string, string[]>`, better-auth's `statement` vocabulary) is
 * the pre-existing shape every caller of `hasWorkspacePermission` already
 * uses; the capability-NAME vocabulary this route may grow into later
 * (`docs/01-architecture/rbac.md`'s `resource:action` strings) is #7's
 * contract to define, not this one's (retrofit plan §3, S2 row).
 */
export const CAPABILITY_CHECKS = {
  manageProjects: { project: ["create", "update", "delete"] },
  createProjects: { project: ["create"] },
  updateProjects: { project: ["update"] },
  deleteProjects: { project: ["delete"] },
  updateTasks: { task: ["update"] },
  createTasks: { task: ["create"] },
  deleteTasks: { task: ["delete"] },
  assignTasks: { task: ["assign"] },
  createLabels: { label: ["create"] },
  updateLabels: { label: ["update"] },
  deleteLabels: { label: ["delete"] },
  manageWorkspace: { workspace: ["update", "manage_settings"] },
  deleteWorkspace: { workspace: ["delete"] },
  inviteUsers: { invitation: ["create"] },
  manageTeam: { member: ["update", "delete"] },
  removeMembers: { member: ["delete"] },
} satisfies Record<string, Record<string, string[]>>;

export type CapabilityName = keyof typeof CAPABILITY_CHECKS;
