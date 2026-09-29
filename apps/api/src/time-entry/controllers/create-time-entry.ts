import { createId } from "@paralleldrive/cuid2";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { resolveDuration } from "../duration";

async function createTimeEntry({
  taskId,
  userId,
  description,
  startTime,
  endTime,
}: {
  taskId: string;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
}) {
  const duration = resolveDuration(startTime, endTime);

  const { createdTimeEntry, task } = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(tx, taskId);
    const [createdTimeEntry] = await tx
      .insert(timeEntryTable)
      .values({
        id: createId(),
        taskId,
        userId,
        description: description || "",
        startTime,
        endTime: endTime || null,
        duration,
      })
      .returning();
    return { createdTimeEntry, task };
  });

  if (!createdTimeEntry) {
    throw new HTTPException(500, {
      message: "Failed to create time entry",
    });
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
