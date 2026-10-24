import { useQuery } from "@tanstack/react-query";
import {
  listRoles,
  type WorkspaceRoleDetail,
} from "@/fetchers/workspace-roles";

/**
 * Every workspace-scope role: the six built-ins and the custom ones, with capabilities, rank and
 * holder count (owner decision, 23 Oct: capabilities live in the canonical `role` row). The
 * pre-canonical `permission` statement view is not exposed; nothing here reads it.
 */
export type WorkspaceRole = WorkspaceRoleDetail & {
  createdAt: Date | string;
  updatedAt?: Date | string | null;
};

export const workspaceRolesKey = (workspaceId: string | undefined) =>
  ["workspace-roles", workspaceId] as const;

function useWorkspaceRoles(workspaceId: string | undefined) {
  return useQuery<WorkspaceRole[]>({
    queryKey: workspaceRolesKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: async () => (workspaceId ? await listRoles(workspaceId) : []),
  });
}

export default useWorkspaceRoles;
