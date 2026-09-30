import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskActivityTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";

async function updateComment(userId: string, id: string, content: string) {
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

  const { updated, projectId } = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(tx, existing.taskId);
    const [updated] = await tx
      .update(taskActivityTable)
      .set({ content })
      .where(
        and(
          eq(taskActivityTable.id, id),
          eq(taskActivityTable.userId, userId),
          eq(taskActivityTable.type, "comment"),
        ),
      )
      .returning();
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
