import { and, eq } from "drizzle-orm";
import db from "../database";
import { cannedResponseTable } from "../database/schema";

/**
 * Query ownership for `canned_response` (issue #580). This is the only module that
 * constructs Drizzle queries on this feature's table; controllers and middleware call
 * these functions and never see a query builder. Every function awaits its query and
 * returns rows (or `undefined`), so a caller cannot keep composing the statement.
 *
 * Tenant scoping stays in the statement: reads and writes by id take the caller's
 * `workspaceId` and filter on it, exactly as the controllers did before. The one
 * deliberate exception is `findCannedResponseWorkspaceId`, which resolves a row's own
 * `workspace_id` for the reach middleware that then authorizes against it.
 */

export type CannedResponse = typeof cannedResponseTable.$inferSelect;
export type NewCannedResponse = Pick<
  typeof cannedResponseTable.$inferInsert,
  "workspaceId" | "name" | "body" | "visibilityDefault" | "createdBy"
>;
export type CannedResponseChanges = Partial<
  typeof cannedResponseTable.$inferInsert
>;

/** The row's own workspace, looked up by id alone (no tenant predicate by design). */
export async function findCannedResponseWorkspaceId(
  id: string,
): Promise<{ workspaceId: string } | undefined> {
  const [row] = await db
    .select({ workspaceId: cannedResponseTable.workspaceId })
    .from(cannedResponseTable)
    .where(eq(cannedResponseTable.id, id))
    .limit(1);
  return row;
}

export async function listCannedResponsesInWorkspace(
  workspaceId: string,
): Promise<CannedResponse[]> {
  return db
    .select()
    .from(cannedResponseTable)
    .where(eq(cannedResponseTable.workspaceId, workspaceId))
    .orderBy(cannedResponseTable.name);
}

export async function insertCannedResponse(
  values: NewCannedResponse,
): Promise<CannedResponse | undefined> {
  const [created] = await db
    .insert(cannedResponseTable)
    .values(values)
    .returning();
  return created;
}

export async function updateCannedResponseInWorkspace(
  id: string,
  workspaceId: string,
  changes: CannedResponseChanges,
): Promise<CannedResponse | undefined> {
  const [updated] = await db
    .update(cannedResponseTable)
    .set(changes)
    .where(
      and(
        eq(cannedResponseTable.id, id),
        eq(cannedResponseTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  return updated;
}

export async function deleteCannedResponseInWorkspace(
  id: string,
  workspaceId: string,
): Promise<CannedResponse | undefined> {
  const [deleted] = await db
    .delete(cannedResponseTable)
    .where(
      and(
        eq(cannedResponseTable.id, id),
        eq(cannedResponseTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  return deleted;
}
