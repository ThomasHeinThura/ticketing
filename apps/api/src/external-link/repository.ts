import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, exists, isNotNull, isNull, sql } from "drizzle-orm";
import db from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { externalLinkTable, projectTable, taskTable } from "../database/schema";

/**
 * The Kaneo task-link columns. `external_link` also holds import provenance rows (0198) that have
 * no task; those are never read through the legacy task readers, which select exactly these
 * columns (so provenance columns cannot reach a legacy response) and never return a null task.
 */
export const taskExternalLinkColumns = {
  id: externalLinkTable.id,
  taskId: sql<string>`${externalLinkTable.taskId}`,
  resourceType: externalLinkTable.resourceType,
  externalId: externalLinkTable.externalId,
  url: sql<string>`${externalLinkTable.url}`,
  title: externalLinkTable.title,
  metadata: externalLinkTable.metadata,
  createdAt: externalLinkTable.createdAt,
  updatedAt: externalLinkTable.updatedAt,
};

/** External-link rows visible through the task's current project reach (issue #580). */
export async function listExternalLinksByTask(
  identity: ResolvedIdentity,
  taskId: string,
) {
  return await db
    .select(taskExternalLinkColumns)
    .from(externalLinkTable)
    .where(
      and(
        eq(externalLinkTable.taskId, taskId),
        isNotNull(externalLinkTable.taskId),
        exists(
          db
            .select({ one: sql`1` })
            .from(taskTable)
            .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
            .where(
              and(
                eq(taskTable.id, externalLinkTable.taskId),
                isNull(projectTable.deletedAt),
                currentProjectReachPredicate(
                  identity,
                  projectTable.id,
                  projectTable.workspaceId,
                  projectTable.organisationId,
                  db,
                ),
              ),
            ),
        ),
      ),
    );
}
