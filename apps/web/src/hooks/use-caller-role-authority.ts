import { useMemo } from "react";
import {
  callerRank,
  heldCapabilities,
} from "@/components/settings/roles/capability-model";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * What the signed-in person's own role lets them do in the role editor: the capabilities they
 * hold (RL-3: nothing beyond them can be granted), their rank (RL-4, RL-14) and whether they may
 * manage roles at all. It only decides which controls are offered; the API re-checks every one.
 */
export function useCallerRoleAuthority(workspaceId: string | undefined) {
  const roles = useWorkspaceRoles(workspaceId);
  const { role } = useWorkspacePermission();
  return useMemo(() => {
    const all = roles.data ?? [];
    const held = heldCapabilities(role, all);
    return {
      roleKey: role,
      rank: callerRank(role, all),
      held,
      canManageRoles: held.has("workspace:manage_roles"),
      canManageMembers: held.has("workspace:manage_members"),
      loading: roles.isLoading,
    };
  }, [role, roles.data, roles.isLoading]);
}
