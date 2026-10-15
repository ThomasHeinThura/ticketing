import { and, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";

/**
 * Query ownership for the realtime sockets' authorization reads (issue #580). Both reads
 * answer `undefined` for the single refusal case; the callers decide the reach rule.
 */

/** A live work item's project, workspace and organisation by key, or `undefined`. */
export async function findLiveWorkItemSocketScope(key: string) {
  const [item] = await db
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
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .limit(1);
  return item;
}

/**
 * A live (not soft-deleted, not archived) project whose workspace the caller reaches,
 * decided inside the lookup by `reachableWorkspacePredicate`, or `undefined`.
 */
export async function findReachableLiveProject(
  projectId: string,
  userId: string,
  apiKeyId?: string,
) {
  const [project] = await db
    .select({
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
        reachableWorkspacePredicate(
          schema.projectTable.workspaceId,
          userId,
          apiKeyId,
        ),
      ),
    )
    .limit(1);
  return project;
}
