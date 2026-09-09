import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import type { UserInvitation } from "@/types/workspace-user";

// S3 (issue #6, retrofit plan §3) correction found while redefining
// apps/web/src/types/workspace-user/index.ts: this fetcher already called
// the native GET /invitation/pending route (the caller's own pending
// invitations), but was typed as `WorkspaceUserInvitation` -- the shape of a
// WORKSPACE's invitations (GET /workspace/{id}/invitations), a different
// endpoint entirely. That only ever compiled because the old
// `WorkspaceUserInvitation` was itself derived from the plugin's loosely
// typed `listInvitations()` return. Retyped here as `UserInvitation`, which
// matches what this call actually returns
// (apps/api/src/invitation/response.ts's pendingInvitationSchema).
export async function getPendingInvitations(): Promise<UserInvitation[]> {
  const response = await client.invitation.pending.$get();

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to get pending invitations");
  }

  return response.json();
}
