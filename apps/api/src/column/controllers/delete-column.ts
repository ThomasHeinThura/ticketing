import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import {
  countTasksInColumn,
  deleteColumnById,
  findColumnById,
} from "../repository";

async function deleteColumn(identity: ResolvedIdentity, id: string) {
  const existing = await findColumnById(identity, id);

  if (!existing) {
    throw new HTTPException(404, { message: "Column not found" });
  }

  // #202: a soft-deleted project's board is frozen, so its columns cannot be
  // removed either. `getProjectWorkspaceId` throws 404 for a soft-deleted
  // project (#187); the workspace id itself isn't needed here.
  await getProjectWorkspaceId(existing.projectId);

  const taskCount = await countTasksInColumn(identity, id);

  if (taskCount && taskCount.count > 0) {
    throw new HTTPException(409, {
      message:
        "Cannot delete column that contains tasks. Move or delete tasks first.",
    });
  }

  const deleted = await deleteColumnById(identity, id);
  if (!deleted) throw new HTTPException(404, { message: "Column not found" });
  return deleted;
}

export default deleteColumn;
