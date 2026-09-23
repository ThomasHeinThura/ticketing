import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskActivityTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";

async function deleteComment(userId: string, id: string) {
  const [existing] = await db
    .select({
      id: taskActivityTable.id,
      content: taskActivityTable.content,
      taskId: taskActivityTable.taskId,
    })
    .from(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  const [deletedComment] = await db
    .delete(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
      ),
    )
    .returning();

  if (!deletedComment) {
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  }

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, deletedComment.taskId))
    .limit(1);

  if (task) {
    await publishEvent("comment.deleted", {
      ...deletedComment,
      projectId: task.projectId,
      userId,
    });
  }

  deleteOrphanedAssets(existing.content, null, {
    taskId: existing.taskId,
  }).catch(() => {});

  return deletedComment;
}

export default deleteComment;
