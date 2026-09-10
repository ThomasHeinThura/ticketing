import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

type InviteWorkspaceMemberBody = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["invitations"]["$post"]
>["json"];

type InviteWorkspaceMemberRequest = InviteWorkspaceMemberBody & {
  workspaceId: string;
};

// S6a (issue #6, retrofit plan §3): native replacement for
// authClient.organization.inviteMember(). The server
// (apps/api/src/workspace/controllers/invite-workspace-member.ts) refuses a
// `role` of `"owner"` and sends the invitation email itself on success.
const inviteWorkspaceMember = async ({
  workspaceId,
  email,
  role,
  resend,
}: InviteWorkspaceMemberRequest) => {
  const response = await client.workspace[":workspaceId"].invitations.$post({
    param: { workspaceId },
    json: { email, role, resend },
  });

  if (!response.ok) {
    // `|| "Failed to invite workspace member"` matches the fallback shape
    // the other native workspace writes use (see update-workspace.ts): an
    // empty non-2xx body must not become a blank `new Error("")`.
    const error = await response.text();
    throw new Error(error || "Failed to invite workspace member");
  }

  return await response.json();
};

export default inviteWorkspaceMember;
