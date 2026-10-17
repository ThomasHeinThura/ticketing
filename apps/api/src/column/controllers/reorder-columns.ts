import { HTTPException } from "hono/http-exception";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import {
  listProjectColumnsOrdered,
  updateColumnPositionInProject,
} from "../repository";

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
    const updated = await updateColumnPositionInProject(
      projectId,
      col.id,
      col.position,
    );

    if (!updated) {
      throw new HTTPException(400, {
        message: `Column ${col.id} does not belong to this project`,
      });
    }
  }

  const updated = await listProjectColumnsOrdered(projectId);

  return updated;
}

export default reorderColumns;
