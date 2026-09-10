import { client } from "@taskdesk/libs";

export type GetActiveWorkspaceUsersRequest = {
  workspaceId: string;
};

// Issue #100 (retrofit plan §3, S3 gap): native replacement for
// authClient.organization.listMembers() -- GET
// /api/workspace/{workspaceId}/members
// (apps/api/src/workspace/index.ts's getWorkspaceMembersRoute).
//
// The native route returns a flat member list (WorkspaceUser: {id, name,
// email, image, role}, where `id` IS the user's own id -- see
// apps/web/src/types/workspace-user/index.ts) with no `{ members: [...] }`
// wrapper and no nested `.user`. Every current caller of this fetcher (via
// use-get-active-workspace-users.ts) destructures the plugin's old
// `{ members: [{ userId, role, user: { name, email, image } }] }` shape --
// 12 files across task assignment, comment mentions and bulk-assign menus.
// Reshaping the response here, once, is the smaller and safer diff than
// touching every one of those call sites; a future cleanup can flatten them
// onto the native shape directly and drop this adapter.
async function getActiveWorkspaceUsers({
  workspaceId,
}: GetActiveWorkspaceUsersRequest) {
  const response = await client.workspace[":workspaceId"].members.$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch workspace users");
  }

  const members = await response.json();

  return {
    members: members.map((member) => ({
      userId: member.id,
      role: member.role,
      user: {
        id: member.id,
        name: member.name,
        email: member.email,
        image: member.image,
      },
    })),
  };
}

export default getActiveWorkspaceUsers;
