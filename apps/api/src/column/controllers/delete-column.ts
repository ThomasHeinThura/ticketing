import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function deleteColumn(id: string) {
  const existing = await db.query.columnTable.findFirst({
    where: eq(columnTable.id, id),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Column not found" });
  }

  // #202: a soft-deleted project's board is frozen, so its columns cannot be
  // removed either. `getProjectWorkspaceId` throws 404 for a soft-deleted
  // project (#187); the workspace id itself isn't needed here.
  await getProjectWorkspaceId(existing.projectId);

  const [taskCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(eq(taskTable.columnId, id));

  if (taskCount && taskCount.count > 0) {
    throw new HTTPException(409, {
      message:
        "Cannot delete column that contains tasks. Move or delete tasks first.",
    });
  }

  await db.delete(columnTable).where(eq(columnTable.id, id));

  return existing;
}

export default deleteColumn;
