import { useMutation } from "@tanstack/react-query";
import deleteWorkspaceRole from "@/fetchers/workspace/delete-workspace-role";

type DeleteWorkspaceRoleRequest = {
  workspaceId: string;
  /** The role's opaque id, NOT its name -- same as use-update-workspace-role.ts. */
  roleId: string;
};

/** Requests role deletion (`202` pending action); the role is kept until approval. */
function useDeleteWorkspaceRole() {
  return useMutation({
    mutationFn: ({ workspaceId, roleId }: DeleteWorkspaceRoleRequest) =>
      deleteWorkspaceRole({ workspaceId, roleId }),
  });
}

export default useDeleteWorkspaceRole;
