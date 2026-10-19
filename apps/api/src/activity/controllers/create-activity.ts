import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  insertTaskActivityForIdentity,
  insertTaskEventActivityFromSubscriber,
  lockTaskAndAssertProjectLiveForActivity,
} from "../repository";

async function createActivity(
  identity: ResolvedIdentity,
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  return db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLiveForActivity(tx, identity, taskId);
    const activity = await insertTaskActivityForIdentity(tx, identity, {
      taskId,
      type,
      userId,
      content,
      eventData: eventData ?? null,
    });
    if (!activity) throw new HTTPException(404, { message: "Task not found" });
    return activity;
  });
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
  return insertTaskEventActivityFromSubscriber({
    taskId,
    type,
    userId,
    content,
    eventData: eventData ?? null,
  });
}

export default createActivity;
