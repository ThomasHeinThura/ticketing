import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function getColumns(projectId: string) {
  // #202: rejects a soft-deleted (or nonexistent) project before returning its board.
  // `getProjectWorkspaceId` applies the #187 `deleted_at` exclusion that
  // `get-project.ts` / `get-tasks.ts` already use; the workspace id itself isn't
  // needed here, same as in `create-column.ts`.
  await getProjectWorkspaceId(projectId);

  const columns = await db
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  return columns;
}

export default getColumns;
