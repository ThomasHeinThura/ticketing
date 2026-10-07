import { listUserWorkspacesQuery } from "../repository";

/**
 * The caller's own workspaces -- and ONLY the caller's own. This is the
 * native replacement for `authClient.organization.list()` (S2, issue #6).
 *
 * Deliberately scoped to `workspace_member.userId = userId`: an instance
 * admin does NOT see every workspace here, because "the caller's
 * workspaces" means membership, not instance authority. Admin-wide listing
 * is a God Mode concern, not this route's.
 */
async function getUserWorkspaces(userId: string) {
  return listUserWorkspacesQuery(userId);
}

export default getUserWorkspaces;
