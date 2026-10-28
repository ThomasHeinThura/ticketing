import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { dbClockUtc } from "../../utils/db-time";
import { invalidateNativeAuthorization } from "../../ws";
import {
  invalidateProjectAncestry,
  lockProjectHierarchy,
} from "../hierarchy.repository";

export default async function restoreProject(
  id: string,
  workspaceId: string,
  actorId: string,
  actorType: "person" | "api_key",
) {
  const restored = await db.transaction(async (tx) => {
    await lockProjectHierarchy(tx, workspaceId);
    const [project] = await tx
      .select({
        row: projectTable,
        withinRestoreWindow: sql<boolean>`${projectTable.purgeAfter} > ${dbClockUtc()}`,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
          isNotNull(projectTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    if (!project.withinRestoreWindow)
      throw new HTTPException(409, {
        message: "The 30 day project restore window has passed",
      });

    const projectRow = project.row;
    const parentId = projectRow.parentId;
    if (parentId !== null) {
      const [parent] = await tx
        .select({ id: projectTable.id })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, parentId),
            eq(projectTable.workspaceId, workspaceId),
            isNull(projectTable.deletedAt),
            isNull(projectTable.archivedAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!parent)
        throw new HTTPException(409, {
          message: "Restore the parent project before restoring this project",
        });
    }

    const [restored] = await tx
      .update(projectTable)
      .set({ deletedAt: null, purgeAfter: null })
      .where(
        and(
          eq(projectTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
          isNotNull(projectTable.deletedAt),
          sql`${projectTable.purgeAfter} > ${dbClockUtc()}`,
        ),
      )
      .returning();
    if (!restored)
      throw new HTTPException(409, {
        message: "The project changed during restore",
      });
    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId,
      projectId: id,
      action: "project.restored",
      entityType: "project",
      entityId: id,
      before: {
        deletedAt: projectRow.deletedAt?.toISOString() ?? null,
        remainsArchived: projectRow.archivedAt !== null,
      },
      after: {
        deletedAt: null,
        remainsArchived: restored.archivedAt !== null,
      },
    });
    invalidateProjectAncestry(tx);
    return restored;
  });

  await invalidateNativeAuthorization({ projectId: id });
  return restored;
}
