import { HTTPException } from "hono/http-exception";
import { getWorkspaceDetailQuery } from "../repository";
import getWorkspaceInvitations from "./get-workspace-invitations";
import getWorkspaceMembers from "./get-workspace-members";

/**
 * The compound "workspace + members + pending invitations" view (S2, issue
 * #6) -- the native replacement for `authClient.organization
 * .getFullOrganization()`.
 *
 * `workspaceAccess.fromParam` has already proven the caller has access (or
 * is an instance admin) before this runs, but admin access bypasses the
 * membership check without proving the workspace itself still exists --
 * so this looks the row up again and 404s if it is gone, rather than
 * building a response around `undefined`. That keeps a stale, deleted, or
 * simply mistyped workspace id a clean 404 instead of a 500 with a stack
 * leak.
 */
async function getWorkspaceDetail(workspaceId: string) {
  const [workspace] = await getWorkspaceDetailQuery(workspaceId);

  if (!workspace) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const [members, pendingInvitations] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    getWorkspaceInvitations(workspaceId),
  ]);

  return { workspace, members, pendingInvitations };
}

export default getWorkspaceDetail;
