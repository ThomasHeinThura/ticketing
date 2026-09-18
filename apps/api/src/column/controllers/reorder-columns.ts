import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function reorderColumns(
  projectId: string,
  columns: Array<{ id: string; position: number }>,
) {
  // #202: a soft-deleted project's board is frozen, so its columns cannot be
  // reordered (or read back) either. `getProjectWorkspaceId` throws 404 for a
  // soft-deleted project (#187); the workspace id itself isn't needed here.
  // Checked once, up front, before any of the per-column writes below.
  await getProjectWorkspaceId(projectId);

  for (const col of columns) {
    const [updated] = await db
      .update(columnTable)
      .set({ position: col.position })
      .where(
        and(eq(columnTable.id, col.id), eq(columnTable.projectId, projectId)),
      )
      .returning({ id: columnTable.id });

    if (!updated) {
      throw new HTTPException(400, {
        message: `Column ${col.id} does not belong to this project`,
      });
    }
  }

  const updated = await db.query.columnTable.findMany({
    where: eq(columnTable.projectId, projectId),
    orderBy: (columns, { asc }) => [asc(columns.position)],
  });

  return updated;
}

export default reorderColumns;
