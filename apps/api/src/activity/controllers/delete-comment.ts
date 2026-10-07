import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskActivityTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { getCommentByAuthor } from "../repository";

async function deleteComment(userId: string, id: string) {
  const [existing] = await getCommentByAuthor(db, userId, id);

  if (!existing) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  const { deletedComment, projectId } = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(tx, existing.taskId);
    const [deletedComment] = await tx
      .delete(taskActivityTable)
      .where(
        and(
          eq(taskActivityTable.id, id),
          eq(taskActivityTable.userId, userId),
          eq(taskActivityTable.type, "comment"),
        ),
      )
      .returning();
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
