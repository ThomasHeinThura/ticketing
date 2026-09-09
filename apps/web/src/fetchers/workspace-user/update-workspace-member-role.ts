import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

type UpdateWorkspaceMemberRoleBody = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["members"][":userId"]["role"]["$patch"]
>["json"];

type UpdateWorkspaceMemberRoleRequest = UpdateWorkspaceMemberRoleBody & {
  workspaceId: string;
  userId: string;
};

// S5 (issue #6, retrofit plan §3): native replacement for
// authClient.organization.updateMemberRole(). Keyed by `userId`, not the
// plugin's `workspace_member.id` row -- the native member shape has no such
// id (apps/web/src/types/workspace-user/index.ts). The server
// (apps/api/src/workspace/controllers/update-workspace-member-role.ts)
// refuses a new `role` of `"owner"` and refuses to touch a target whose
// CURRENT role is `"owner"`; both surface here as an ordinary rejected
// response, not a special case.
const updateWorkspaceMemberRole = async ({
  workspaceId,
  userId,
  role,
}: UpdateWorkspaceMemberRoleRequest) => {
  const response = await client.workspace[":workspaceId"].members[
    ":userId"
  ].role.$patch({
    param: { workspaceId, userId },
    json: { role },
  });

  if (!response.ok) {
    // `|| "Failed to update workspace member role"` matches the fallback
    // shape the other native workspace writes use (see update-workspace.ts):
    // an empty non-2xx body -- a reverse-proxy 502/504 that never reaches
    // Hono's own error handler, which always supplies a message -- must not
    // become a blank `new Error("")` that renders as a blank toast.
    const error = await response.text();
    throw new Error(error || "Failed to update workspace member role");
  }

  return await response.json();
};

export default updateWorkspaceMemberRole;
