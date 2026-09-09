import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";

/**
 * Delete a workspace.
 *
 * HARD delete, over the existing `ON DELETE CASCADE` chains off
 * `workspace.id` — members, roles, teams, team members, projects, tasks and
 * the rest. The documented target adds a 30-day recovery window
 * (`deleted_at` / `purge_after`), but those columns do not exist and adding
 * them is a migration the retrofit plan defers out of P0 (§3.2). The ROUTE is
 * the P0 obligation; soft delete is a later phase.
 *
 * The caller's session selection is cleared in the same transaction when it
 * pointed at this workspace, matching the inherited route's blast radius —
 * the CALLER's session only. Other users' sessions keep a stale
 * `active_organization_id` exactly as they do today (retrofit plan R2).
 *
 * One deliberate, narrower divergence: the inherited route clears only
 * `active_organization_id`. The workspace's teams are cascade-deleted with
 * it, so `active_team_id` is cleared too rather than left pointing at a row
 * that no longer exists.
 */
async function deleteWorkspace(workspaceId: string, sessionId: string) {
  return db.transaction(async (tx) => {
    await tx
      .update(schema.sessionTable)
      .set({ activeOrganizationId: null, activeTeamId: null })
      .where(
        and(
          eq(schema.sessionTable.id, sessionId),
          eq(schema.sessionTable.activeOrganizationId, workspaceId),
        ),
      );

    const [deleted] = await tx
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId))
      .returning({ id: schema.workspaceTable.id });

    return deleted ?? null;
  });
}

export default deleteWorkspace;
