import { type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { workspaceRoleSeesAllProjects } from "../permissions/workspace-project-reach";
import type { CallerReachProjectFact } from "../utils/caller-reach";

/** Whether a workspace owner/admin/manager reaches this project only via see-all. */
export function projectSeenOnlyViaWorkspaceRole(
  identity: ResolvedIdentity | null,
  project: CallerReachProjectFact,
): boolean {
  if (
    identity?.side !== "staff" ||
    !identity.authority.some(
      (role) =>
        role.scope === "workspace" &&
        role.scopeId === project.workspaceId &&
        workspaceRoleSeesAllProjects(role.roleKey),
    )
  )
    return false;
  return !reaches(
    { ...identity, reach: { kind: "membership" } },
    {
      projectId: project.id,
      workspaceId: project.workspaceId,
      organisationId: project.organisationId,
      ancestorProjectIds: project.ancestorProjectIds,
      ownerTeamId: project.ownerTeamId,
    },
  );
}
