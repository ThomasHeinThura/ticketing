import { client } from "@taskdesk/libs";

export type DeleteWorkspaceRoleRequest = {
  workspaceId: string;
  roleId: string;
};

// S7 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.deleteRole(). Keyed by the role's opaque `id`, NOT
// its name -- see update-workspace-role.ts. The server refuses "owner" and a
// role still assigned to any member.
const deleteWorkspaceRole = async ({
  workspaceId,
  roleId,
}: DeleteWorkspaceRoleRequest) => {
  const response = await client.workspace[":workspaceId"].roles[
    ":roleId"
  ].$delete({
    param: { workspaceId, roleId },
  });

  if (!response.ok) {
    // `|| "Failed to delete role"` matches the fallback shape the other
    // native workspace writes use (see update-workspace.ts).
    const error = await response.text();
    throw new Error(error || "Failed to delete role");
  }

  return await response.json();
};

export default deleteWorkspaceRole;
