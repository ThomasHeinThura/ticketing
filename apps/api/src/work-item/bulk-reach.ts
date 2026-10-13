import { reaches } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import db, { schema } from "../database";
import { resolveCallerIdentity } from "../utils/has-project-reach";

/**
 * Per-item project reach for `POST /api/work-items/bulk`, whose request names many items
 * and so cannot use the single-item `requireWorkItemReach()` middleware. Resolves the
 * caller's identity once and returns a predicate that answers, per key, whether the item's
 * project is within the caller's reach. A missing item, an item in another workspace and
 * an item the caller cannot reach all answer `false` (the caller reports one shared
 * "not found" reason, `WI-25`). Fails closed: no resolvable identity reaches nothing.
 */
export async function workItemReachCheck(
  c: Context,
  userId: string,
  workspaceId: string,
): Promise<(key: string) => Promise<boolean>> {
  const identity = await resolveCallerIdentity(c, userId);
  return async (key) => {
    if (!identity) return false;
    const [row] = await db
      .select({
        projectId: schema.workItemTable.projectId,
        workspaceId: schema.workItemTable.workspaceId,
        organisationId: schema.workspaceTable.organisationId,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
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
    if (!row) return false;
    return reaches(identity, {
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      organisationId: row.organisationId,
      ancestorProjectIds: [],
      ownerTeamId: null,
    });
  };
}
