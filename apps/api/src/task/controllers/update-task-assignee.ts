import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";

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

  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // #202: unconditional, and hoisted above the early return below. It used to run
  // only when an assignee was actually being set (`getProjectWorkspaceId` was called
  // inside `if (nextAssigneeId)`), so *unassigning* a task in a soft-deleted project
  // slipped through the freeze entirely (#187, PR-16). The returned workspace id is
  // reused by `assertAssignableUser` rather than looked up a second time.
  const projectWorkspaceId = await getProjectWorkspaceId(
    existingTask.projectId,
  );

  const nextAssigneeId = userId?.trim() || null;
  if (existingTask.userId === nextAssigneeId) {
    return existingTask;
  }

  if (nextAssigneeId) {
    await assertAssignableUser(nextAssigneeId, projectWorkspaceId);
  }

  const [updatedTask] = await db
    .update(taskTable)
    .set({ userId: nextAssigneeId })
    .where(eq(taskTable.id, id))
    .returning();

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
