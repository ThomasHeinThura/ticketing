import { useQuery } from "@tanstack/react-query";
import listWorkspaceRoles from "@/fetchers/workspace/list-workspace-roles";

export type WorkspaceRole = {
  id: string;
  workspaceId: string;
  role: string;
  permission: Record<string, string[]>;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
};

// S7 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.listRoles(). The native route always returns
// `permission` as a parsed object (never a JSON string), but the
// object-passthrough branch is kept defensively -- harmless, and it means a
// stray malformed response fails soft (an empty map) rather than throwing.
function parsePermission(raw: unknown): Record<string, string[]> {
  if (raw && typeof raw === "object") {
    return raw as Record<string, string[]>;
  }
  return {};
}

function useWorkspaceRoles(workspaceId: string | undefined) {
  return useQuery<WorkspaceRole[]>({
    queryKey: ["workspace-roles", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      if (!workspaceId) return [];
      const roles = await listWorkspaceRoles({ workspaceId });

      return roles.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        role: r.role,
        permission: parsePermission(r.permission),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    },
  });
}

export default useWorkspaceRoles;
