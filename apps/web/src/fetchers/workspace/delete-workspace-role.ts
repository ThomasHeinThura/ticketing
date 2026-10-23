import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

export type DeleteWorkspaceRoleRequest = {
  workspaceId: string;
  roleId: string;
};

// Keyed by the role's opaque `id`, NOT its name -- see update-workspace-role.ts. The server
// refuses "owner" and a role still assigned to any member. Deletion is requested here and
// completed only when the requester approves the pending action.
const deleteWorkspaceRole = async ({
  workspaceId,
  roleId,
}: DeleteWorkspaceRoleRequest) => {
  const response = await client.workspace[":workspaceId"].roles[
    ":roleId"
  ].$delete({
    param: { workspaceId, roleId },
  });
  return readPendingDeletion(response, "Failed to delete role");
};

export default deleteWorkspaceRole;
