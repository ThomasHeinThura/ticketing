import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";

/** Current, reached project facts for a linked work item. */
export async function findWorkItemProjectOwner(
  identity: ResolvedIdentity,
  workItemId: string,
) {
  const [owner] = await db
    .select({
      projectId: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.workItemTable.id, workItemId),
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
  return owner;
}
