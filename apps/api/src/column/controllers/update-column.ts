import { HTTPException } from "hono/http-exception";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { findColumnById, updateColumnById } from "../repository";

async function updateColumn(
  id: string,
  data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    isFinal?: boolean;
  },
) {
  const existing = await findColumnById(id);

  if (!existing) {
    throw new HTTPException(404, { message: "Column not found" });
  }

  // #202: a soft-deleted project's board is frozen, so its columns cannot be
  // renamed/re-coloured either. `getProjectWorkspaceId` throws 404 for a
  // soft-deleted project (#187); the workspace id itself isn't needed here.
  await getProjectWorkspaceId(existing.projectId);

  const updated = await updateColumnById(id, {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.icon !== undefined && { icon: data.icon }),
    ...(data.color !== undefined && { color: data.color }),
    ...(data.isFinal !== undefined && { isFinal: data.isFinal }),
  });

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to update column" });
  }

  return updated;
}

export default updateColumn;
