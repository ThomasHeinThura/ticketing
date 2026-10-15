import db from "../../database";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { insertTaskActivity } from "../repository";

async function createActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const activity = await db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, taskId);
    return insertTaskActivity(tx, {
      taskId,
      type,
      userId,
      content,
      eventData,
    });
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
  return insertTaskActivity(db, {
    taskId,
    type,
    userId,
    content,
    eventData,
  });
}

export default createActivity;
