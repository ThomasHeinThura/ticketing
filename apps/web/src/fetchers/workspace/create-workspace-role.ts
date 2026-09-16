import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

type CreateWorkspaceRoleBody = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["roles"]["$post"]
>["json"];

type CreateWorkspaceRoleRequest = CreateWorkspaceRoleBody & {
  workspaceId: string;
};

// S7 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.createRole(). The server
// (apps/api/src/workspace/controllers/create-workspace-role.ts) refuses the
// name "owner", an unknown permission resource, granting a permission the
// caller does not themselves hold (RL-3), and the 25-role ceiling.
const createWorkspaceRole = async ({
  workspaceId,
  role,
  permission,
}: CreateWorkspaceRoleRequest) => {
  const response = await client.workspace[":workspaceId"].roles.$post({
    param: { workspaceId },
    json: { role, permission },
  });

  if (!response.ok) {
    // `|| "Failed to create role"` matches the fallback shape the other
    // native workspace writes use (see update-workspace.ts).
    const error = await response.text();
    throw new Error(error || "Failed to create role");
  }

  return await response.json();
};

export default createWorkspaceRole;
