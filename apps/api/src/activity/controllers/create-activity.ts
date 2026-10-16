import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  insertTaskActivity,
  lockTaskAndAssertProjectLive,
  resolveActorIdentity,
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
    await lockTaskAndAssertProjectLive(tx, identity, taskId);
    const row = await insertTaskActivity(tx, identity, {
      taskId,
      type,
      userId,
      content,
      eventData,
    });
    if (!row) throw new HTTPException(404, { message: "Task not found" });
    return row;
  });
}

/** Internal event subscriber; actor identity is freshly resolved before the scoped insert. */
export async function recordTaskEventActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const identity = await resolveActorIdentity(userId);
  if (!identity) return undefined;
  return insertTaskActivity(db, identity, {
    taskId,
    type,
    userId,
    content,
    eventData,
  });
}

export default createActivity;
