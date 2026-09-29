import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertAssignableUser } from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";

async function updateTaskAssignee({
  id,
  userId,
  currentUserId,
}: {
  id: string;
  userId: string | null;
  currentUserId: string;
}) {
  // #290 S4 sweep: `userId` is a body field, not covered by `workspaceAccess.
  // fromTask()` (which only guards `id`) -- a NUL byte here reached
  // `assertAssignableUser`'s/`eq(userTable.id, ...)`'s raw queries below unvalidated
  // and 500'd, the same class #281 fixed for path/query ids. `null` (unassign) is
  // left alone.
  if (userId) {
    rejectNulByte(userId, "Assignee id");
  }

  const nextAssigneeId = userId?.trim() || null;
  const { existingTask, updatedTask } = await db.transaction(async (tx) => {
    const existingTask = await lockTaskAndAssertProjectLive(tx, id);
    if (existingTask.userId === nextAssigneeId) {
      return { existingTask, updatedTask: existingTask };
    }
    if (nextAssigneeId) {
      const [project] = await tx
        .select({ workspaceId: projectTable.workspaceId })
        .from(projectTable)
        .where(eq(projectTable.id, existingTask.projectId));
      if (!project) throw new HTTPException(404, { message: "Task not found" });
      await assertAssignableUser(nextAssigneeId, project.workspaceId);
    }
    const [updatedTask] = await tx
      .update(taskTable)
      .set({ userId: nextAssigneeId })
      .where(eq(taskTable.id, id))
      .returning();
    return { existingTask, updatedTask };
  });
  if (existingTask.userId === nextAssigneeId) return updatedTask;

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task assignee",
    });
  }

  const newAssigneeName = nextAssigneeId
    ? (
        await db
          .select({ name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, nextAssigneeId))
          .limit(1)
      )[0]?.name
    : undefined;

  if (!nextAssigneeId) {
    await publishEvent("task.unassigned", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      title: updatedTask.title,
      type: "unassigned",
    });

    return updatedTask;
  }

  await publishEvent("task.assignee_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldAssignee: existingTask.userId,
    newAssignee: newAssigneeName,
    newAssigneeId: nextAssigneeId,
    title: updatedTask.title,
    type: "assignee_changed",
  });

  return updatedTask;
}

export default updateTaskAssignee;
