import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { deleteOwnComment, findOwnComment } from "../repository";

async function deleteComment(userId: string, id: string) {
  const existing = await findOwnComment(userId, id);

  if (!existing) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  const { deletedComment, projectId } = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(tx, existing.taskId);
    const deletedComment = await deleteOwnComment(tx, userId, id);
    return { deletedComment, projectId: task.projectId };
  });

  if (!deletedComment) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  await publishEvent("comment.deleted", {
    ...deletedComment,
    projectId,
    userId,
  });

  deleteOrphanedAssets(existing.content, null, {
    taskId: existing.taskId,
  }).catch(() => {});

  return deletedComment;
}

export default deleteComment;
