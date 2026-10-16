import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";

/** Live work-item topic facts, selected only while current project reach holds. */
export async function findLiveWorkItemSocketScope(
  identity: ResolvedIdentity,
  key: string,
) {
  const [item] = await db
    .select({
      projectId: schema.workItemTable.projectId,
      workspaceId: schema.workItemTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.workItemTable.projectId, schema.projectTable.id),
    )
    .where(
      and(
        eq(schema.workItemTable.key, key),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          schema.projectTable.id,
          schema.projectTable.workspaceId,
          schema.projectTable.organisationId,
          db,
        ),
      ),
    )
    .limit(1);
  return item;
}

/** Live project facts for either socket, with current workspace and project reach in SQL. */
export async function findReachableLiveProject(
  identity: ResolvedIdentity,
  projectId: string,
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
        currentWorkspaceReachPredicate(
          identity,
          schema.projectTable.workspaceId,
          db,
        ),
        currentProjectReachPredicate(
          identity,
          schema.projectTable.id,
          schema.projectTable.workspaceId,
          schema.projectTable.organisationId,
          db,
        ),
      ),
    )
    .limit(1);
  return project;
}
