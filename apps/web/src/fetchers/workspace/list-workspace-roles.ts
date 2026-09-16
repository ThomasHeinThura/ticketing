import { client } from "@taskdesk/libs";

export type ListWorkspaceRolesRequest = { workspaceId: string };

// S7 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.listRoles(). Returns every workspace_role row --
// `permission` already parsed into an object server-side -- and never
// includes "owner", which stays a compiled, non-editable role.
const listWorkspaceRoles = async ({
  workspaceId,
}: ListWorkspaceRolesRequest) => {
  const response = await client.workspace[":workspaceId"].roles.$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    // `|| "Failed to list workspace roles"` matches the fallback shape the
    // other native workspace writes use (see update-workspace.ts).
    const error = await response.text();
    throw new Error(error || "Failed to list workspace roles");
  }

  return await response.json();
};

export default listWorkspaceRoles;
