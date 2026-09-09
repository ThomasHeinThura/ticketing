import { eq } from "drizzle-orm";
import db from "../../database";
import { workspaceTable, workspaceUserTable } from "../../database/schema";

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
  return db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      logo: workspaceTable.logo,
      description: workspaceTable.description,
      createdAt: workspaceTable.createdAt,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceUserTable.workspaceId, workspaceTable.id),
    )
    .where(eq(workspaceUserTable.userId, userId));
}

export default getUserWorkspaces;
