import { useQuery } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import { useMemo } from "react";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";

export type PermissionLevel = "owner" | "admin" | "member";

// S3 (issue #6, retrofit plan §3, matrix row 15): native replacement for the
// 16-way authClient.organization.hasPermission() fan-out, replaced by one
// call to GET /api/capabilities (apps/api/src/capabilities/index.ts), which
// computes the exact same 16 keys server-side over hasWorkspacePermission --
// see apps/api/src/capabilities/capability-checks.ts, a deliberate
// server-side duplicate of the map this file used to carry.
type CapabilityMap = Record<keyof typeof EMPTY_CAPABILITIES, boolean> & {
  createPublicComments?: boolean;
  createInternalComments?: boolean;
  // Strict work_item:transition / work_item:rank, exactly as /api/capabilities returns
  // them. Optional so an older server fails closed; never inferred from `updateTasks`,
  // which is a different, broader capability.
  transitionTasks?: boolean;
  rankTasks?: boolean;
  // Strict project:create (owner/admin/manager) -- the server rule for listing customer
  // organisations and binding a project to one. Never inferred from `createProjects`, which
  // follows the broader legacy statement (members hold it).
  bindProjectOrganisation?: boolean;
  // Strict project:manage_settings (owner/admin/manager) -- gates project-level settings such
  // as CA-2's default comment visibility. Never inferred from `manageProjects`/`updateProjects`,
  // which follow the broader legacy statement (#708).
  manageProjectSettings?: boolean;
};

// Mirrors apps/api/src/capabilities/response.ts's capabilitiesResponseSchema
// key-for-key. Used only as the "no data yet" fallback -- the real values
// always come from the server.
const EMPTY_CAPABILITIES = {
  manageProjects: false,
  createProjects: false,
  updateProjects: false,
  deleteProjects: false,
  updateTasks: false,
  createTasks: false,
  deleteTasks: false,
  assignTasks: false,
  createLabels: false,
  updateLabels: false,
  deleteLabels: false,
  manageWorkspace: false,
  deleteWorkspace: false,
  inviteUsers: false,
  manageTeam: false,
  removeMembers: false,
  manageServiceCalendars: false,
  // saved_view:share and workspace:manage_settings, exactly as /api/capabilities returns them:
  // they decide which audiences a saved view may be given (`SV-15`, `SV-18`). The server still
  // enforces every create and update; these only decide which choices are offered.
  shareSavedViews: false,
  manageWorkspaceSettings: false,
} as const satisfies Record<string, boolean>;

export function useWorkspacePermission(targetWorkspaceId?: string) {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useGetActiveWorkspaceUser();
  const isTargetScoped = targetWorkspaceId !== undefined;
  const workspaceId = targetWorkspaceId ?? activeWorkspace?.id;
  const role = isTargetScoped
    ? undefined
    : (activeMember?.role as string | undefined);

  // One query per (workspaceId, role) that replaces all 16 round trips with
  // a single GET /api/capabilities call. Refetches when either changes,
  // e.g. when the admin edits the role's permissions in the Roles UI and we
  // invalidate this key -- see use-update-workspace-user-role.ts and
  // use-transfer-workspace-ownership.ts, which both already invalidate
  // ["workspace-capabilities", workspaceId] on role changes, and keep doing
  // so unmodified: this key's first two elements are unchanged, so those
  // existing invalidations still match this query.
  const {
    data: capabilities,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: isTargetScoped
      ? ["workspace-capabilities", workspaceId, "work-item-target"]
      : ["workspace-capabilities", workspaceId, role],
    enabled: Boolean(workspaceId && (isTargetScoped || role)),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CapabilityMap> => {
      const response = await client.capabilities.$get({
        query: { workspaceId: workspaceId as string },
      });

      if (!response.ok) {
        throw new Error("Failed to get capabilities");
      }

      return response.json();
    },
  });

  const can: CapabilityMap = capabilities ?? EMPTY_CAPABILITIES;

  const helpers = useMemo(() => {
    return {
      canManageProjects: () => can.manageProjects,
      canCreateProjects: () => can.createProjects,
      canUpdateProjects: () => can.updateProjects,
      canDeleteProjects: () => can.deleteProjects,
      canUpdateTasks: () => can.updateTasks,
      canCreateTasks: () => can.createTasks,
      canDeleteTasks: () => can.deleteTasks,
      canAssignTasks: () => can.assignTasks,
      canCreateLabels: () => can.createLabels,
      canUpdateLabels: () => can.updateLabels,
      canDeleteLabels: () => can.deleteLabels,
      canManageWorkspace: () => can.manageWorkspace,
      canDeleteWorkspace: () => can.deleteWorkspace,
      canInviteUsers: () => can.inviteUsers,
      canManageTeam: () => can.manageTeam,
      canRemoveMembers: () => can.removeMembers,
      canManageServiceCalendars: () => can.manageServiceCalendars,
      canShareSavedViews: () => can.shareSavedViews,
      canManageWorkspaceSettings: () => can.manageWorkspaceSettings,
      canCreatePublicComments: () => can.createPublicComments === true,
      canCreateInternalComments: () => can.createInternalComments === true,
      canTransitionTasks: () => can.transitionTasks === true,
      canRankTasks: () => can.rankTasks === true,
      canManageProjectSettings: () => can.manageProjectSettings === true,
      canBindProjectOrganisation: () => can.bindProjectOrganisation === true,
    };
  }, [can]);

  return {
    ...helpers,
    workspace: isTargetScoped ? undefined : activeWorkspace,
    member: isTargetScoped ? undefined : activeMember,
    role,
    isOwner: !isTargetScoped && role === "owner",
    isAdmin: !isTargetScoped && (role === "owner" || role === "admin"),
    // True while the first capability fetch is in flight. Useful for hiding
    // action UI during the initial render instead of flashing it on then
    // off when the server check resolves.
    isCheckingPermissions:
      Boolean(workspaceId && (isTargetScoped || role)) &&
      (isLoading || !capabilities),
    isRefetchingPermissions: isFetching,
  };
}
