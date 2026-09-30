import db from "../../database";
import { taskActivityTable } from "../../database/schema";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";

async function createActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const activity = await db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, taskId);
    const [row] = await tx
      .insert(taskActivityTable)
      .values({
        taskId,
        type,
        userId,
        content,
        eventData: eventData ?? null,
      })
      .returning();
    return row;
  });
  return activity;
}

/**
 * Persist an event already emitted by a successful task write. Unlike the
 * public activity-create endpoint, this internal subscriber must preserve the
 * task history if archive wins between the task transaction and async event
 * delivery. This function is only imported by trusted event subscribers.
 */
export async function recordTaskEventActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const [activity] = await db
    .insert(taskActivityTable)
    .values({
      taskId,
      type,
      userId,
      content,
      eventData: eventData ?? null,
    })
    .returning();
  return activity;
}

export default createActivity;
