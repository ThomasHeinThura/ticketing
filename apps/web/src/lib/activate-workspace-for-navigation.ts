import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import { authClient } from "@/lib/auth-client";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

/** Wait until canonical routes can resolve against the newly active workspace. */
export async function activateWorkspaceForNavigation(workspaceId: string) {
  await activateWorkspace(workspaceId);
  const session = authClient.$store.atoms.session;
  await session.get().refetch();
  const current = session.get();
  if (current.error || getActiveOrganizationId(current.data) !== workspaceId) {
    throw new Error("Workspace session refresh failed");
  }
}
