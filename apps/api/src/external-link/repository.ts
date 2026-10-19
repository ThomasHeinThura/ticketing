import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import db from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { externalLinkTable, projectTable, taskTable } from "../database/schema";

/** External-link rows visible through the task's current project reach (issue #580). */
export async function listExternalLinksByTask(
  identity: ResolvedIdentity,
  taskId: string,
) {
  return await db
    .select()
    .from(externalLinkTable)
    .where(
      and(
        eq(externalLinkTable.taskId, taskId),
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
