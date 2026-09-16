import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

type UpdateWorkspaceRoleBody = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["roles"][":roleId"]["$patch"]
>["json"];

type UpdateWorkspaceRoleRequest = UpdateWorkspaceRoleBody & {
  workspaceId: string;
  roleId: string;
};

// S7 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.updateRole(). Keyed by the role's opaque `id`, NOT
// its name -- a role name may legitimately contain a `/`, which would be
// unaddressable as a path segment (S7 blueprint Ambiguity Q1). Replaces
// (never merges) the entire permission set; the server also refuses to grant
// a permission the caller does not themselves hold (RL-3).
const updateWorkspaceRole = async ({
  workspaceId,
  roleId,
  permission,
}: UpdateWorkspaceRoleRequest) => {
  const response = await client.workspace[":workspaceId"].roles[
    ":roleId"
  ].$patch({
    param: { workspaceId, roleId },
    json: { permission },
  });

  if (!response.ok) {
    // `|| "Failed to update role"` matches the fallback shape the other
    // native workspace writes use (see update-workspace.ts).
    const error = await response.text();
    throw new Error(error || "Failed to update role");
  }

  return await response.json();
};

export default updateWorkspaceRole;
