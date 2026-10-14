import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../database";
import { callerReach } from "../utils/caller-reach";

export type BulkItemDecision = "ok" | "not_found" | "forbidden";

/**
 * Per-item authorisation for `POST /api/work-items/bulk`, whose request names many items and
 * so cannot use the single-item `requireWorkItemReach()` middleware. For each key it answers
 * the same two questions the single-item routes answer, from the same decision source
 * (`utils/caller-reach.ts`):
 *  - project REACH: a missing item, an item in another workspace and an unreachable item are
 *    all `not_found` (`WI-25`: one shared reason);
 *  - the operation's project-level CAPABILITY (`work_item:delete` / `work_item:assign`):
 *    reachable without it is `forbidden`.
 */
export async function workItemBulkAuthoriser(
  c: Context,
  userId: string,
  workspaceId: string,
  capability: "work_item:delete" | "work_item:assign",
): Promise<(key: string) => Promise<BulkItemDecision>> {
  const reach = await callerReach(c, userId);
  return async (key) => {
    const [row] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
        workspaceId: schema.workItemTable.workspaceId,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .where(
        and(
          eq(schema.workItemTable.key, key),
          eq(schema.workItemTable.workspaceId, workspaceId),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (!row || !(await reach.reaches(row))) return "not_found";
    return (await reach.can(capability, row)) ? "ok" : "forbidden";
  };
}
