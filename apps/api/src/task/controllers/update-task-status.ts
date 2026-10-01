import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";
import { assertValidTaskStatus } from "../validate-task-fields";

async function updateTaskStatus({
  id,
  status,
  currentUserId,
}: {
  id: string;
  status: string;
  currentUserId: string;
}) {
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLive(tx, id);
    await assertValidTaskStatus(status, existingTask.projectId, tx);
    const column = await tx.query.columnTable.findFirst({
      where: and(
        eq(columnTable.projectId, existingTask.projectId),
        eq(columnTable.slug, status),
      ),
    });
    const [updatedTask] = await tx
      .update(taskTable)
      .set({
        status,
        columnId: column?.id ?? null,
        version: sql`${taskTable.version} + 1`,
      })
      .where(eq(taskTable.id, id))
      .returning();
    return { existingTask, updatedTask };
  });

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task status",
    });
  }

  await publishEvent("task.status_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldStatus: existingTask.status,
    newStatus: status,
    title: updatedTask.title,
    assigneeId: updatedTask.userId,
    type: "status_changed",
  });

  await publishEvent("task-relation.refresh", {
    projectId: updatedTask.projectId,
    userId: currentUserId,
  });

  return updatedTask;
}

export default updateTaskStatus;
