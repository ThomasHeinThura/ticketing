import { and, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";

export function getRealtimeProject(projectId: string) {
  return db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.projectTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
    )
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .limit(1);
}

export function getRealtimeWorkItem(key: string) {
  return db
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
}
