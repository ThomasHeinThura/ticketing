import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function getColumns(projectId: string) {
  // #202: rejects a soft-deleted project before returning its board. A *nonexistent*
  // project never reaches here -- `workspaceAccess.fromProject` resolves the project
  // itself and has no fallback source, so it answers 400 first. `getProjectWorkspaceId`
  // applies the #187 `deleted_at` exclusion that `get-project.ts` / `get-tasks.ts` also
  // use; the workspace id itself isn't needed here, same as in `create-column.ts`.
  await getProjectWorkspaceId(projectId);

  const columns = await db
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  return columns;
}

export default getColumns;
