import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  insertTaskActivity,
  lockTaskAndAssertProjectLive,
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

export default createActivity;
