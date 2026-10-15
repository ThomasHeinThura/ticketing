import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { findOwnComment, updateOwnCommentContent } from "../repository";

async function updateComment(userId: string, id: string, content: string) {
  const existing = await findOwnComment(userId, id);

  if (!existing) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  const { updated, projectId } = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(tx, existing.taskId);
    const updated = await updateOwnCommentContent(tx, userId, id, content);
    return { updated, projectId: task.projectId };
  });

  if (!updated) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  await publishEvent("comment.updated", {
    ...updated,
    projectId,
    userId,
  });

  deleteOrphanedAssets(existing.content, content, {
    taskId: existing.taskId,
  }).catch(() => {});

  return updated;
}

export default updateComment;
