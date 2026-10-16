import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { resolveDuration } from "../duration";
import { insertTimeEntry, lockTaskAndAssertProjectLive } from "../repository";

async function createTimeEntry({
  taskId,
  identity,
  userId,
  description,
  startTime,
  endTime,
}: {
  taskId: string;
  identity: ResolvedIdentity;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
}) {
  const { createdTimeEntry, task } = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(tx, identity, taskId);
    const duration = resolveDuration(startTime, endTime);
    const createdTimeEntry = await insertTimeEntry(tx, identity, {
      id: createId(),
      taskId,
      userId,
      description: description || "",
      startTime,
      endTime: endTime || null,
      duration,
    });
    return { createdTimeEntry, task };
  });

  if (!createdTimeEntry) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  await publishEvent("time-entry.created", {
    timeEntryId: createdTimeEntry.id,
    taskId: createdTimeEntry.taskId,
    userId,
    type: "create",
    content: "started time tracking",
    taskOwnerId: task.userId,
    taskTitle: task.title,
  });

  return createdTimeEntry;
}

export default createTimeEntry;
