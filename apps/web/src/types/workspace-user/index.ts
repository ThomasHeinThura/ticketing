import type { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";

// S3 (issue #6, retrofit plan §3, matrix row 28): native replacements for the
// four `Awaited<ReturnType<typeof authClient.organization.*>>` aliases this
// file used to carry. Derived from the real TaskDesk response shapes in
// apps/api/src/workspace/response.ts and apps/api/src/invitation/response.ts
// -- read directly, not guessed from the plugin's shapes.

// GET /api/workspace/{workspaceId}/members -- one workspace member. FLAT: no
// nested `.user`, and `id` IS the user's own id
// (apps/api/src/workspace/controllers/get-workspace-members.ts selects
// `userTable.id`, not a separate membership-row id -- the plugin's
// `workspace_member.id` primary key has no client-visible equivalent here).
// Native replacement for authClient.organization.listMembers().
export type WorkspaceUser = InferResponseType<
  (typeof client)["workspace"][":workspaceId"]["members"]["$get"],
  200
>[number];

// The current caller's own membership row in a workspace -- same flat shape
// as WorkspaceUser, resolved client-side by filtering the member list down to
// the caller's own user id
// (apps/web/src/hooks/queries/workspace-users/use-active-workspace-user.ts).
// Native replacement for authClient.organization.getActiveMember(), which
// (per the retrofit plan matrix row 13) was referenced only as a type before
// this change -- no code ever called it.
export type ActiveWorkspaceUser = WorkspaceUser;

// GET /api/workspace/{workspaceId}/invitations -- a workspace's own pending,
// unexpired invitations. Native replacement for
// authClient.organization.listInvitations().
export type WorkspaceUserInvitation = InferResponseType<
  (typeof client)["workspace"][":workspaceId"]["invitations"]["$get"],
  200
>[number];

// GET /invitation/pending -- the CALLING USER's own pending invitations
// (unrelated to any single workspace). Native replacement for
// authClient.organization.listUserInvitations(). Verified zero importers of
// this type anywhere in apps/web/src at the time of this change -- kept for
// this module's public shape, not because anything currently consumes it.
export type UserInvitation = InferResponseType<
  (typeof client)["invitation"]["pending"]["$get"],
  200
>[number];

export default WorkspaceUser;
