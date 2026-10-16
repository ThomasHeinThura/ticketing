import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import {
  ColumnReorderScopeError,
  listProjectColumnsOrdered,
  updateColumnPositionInProject,
} from "../repository";

async function reorderColumns(
  identity: ResolvedIdentity,
  projectId: string,
  columns: Array<{ id: string; position: number }>,
) {
  // #202: a soft-deleted project's board is frozen, so its columns cannot be
  // reordered (or read back) either. `getProjectWorkspaceId` throws 404 for a
  // soft-deleted project (#187); the workspace id itself isn't needed here.
  // Checked once, up front, before any of the per-column writes below.
  await getProjectWorkspaceId(projectId);

  try {
    return await db.transaction(async (tx) => {
      for (const column of columns) {
        const updated = await updateColumnPositionInProject(
          identity,
          projectId,
          column.id,
          column.position,
          tx,
        );
        if (!updated) throw new ColumnReorderScopeError(column.id);
      }
      return await listProjectColumnsOrdered(identity, projectId, tx);
    });
  } catch (error) {
    if (error instanceof ColumnReorderScopeError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
}

export default reorderColumns;
