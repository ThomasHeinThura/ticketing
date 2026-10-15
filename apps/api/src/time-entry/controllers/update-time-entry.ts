import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { resolveDuration } from "../duration";
import { findTimeEntryById, updateTimeEntryById } from "../repository";

type UpdateTimeEntryParams = {
  timeEntryId: string;
  startTime: Date;
  endTime?: Date;
  description?: string;
};

async function updateTimeEntry(params: UpdateTimeEntryParams) {
  const { timeEntryId, startTime, endTime, description } = params;

  const existingTimeEntry = await findTimeEntryById(timeEntryId);

  if (!existingTimeEntry) {
    throw new HTTPException(404, {
      message: "Time entry not found",
    });
  }

  const effectiveEndTime = endTime ?? existingTimeEntry.endTime;

  return db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, existingTimeEntry.taskId);
    const duration = resolveDuration(startTime, effectiveEndTime ?? undefined);
    const updatedTimeEntry = await updateTimeEntryById(tx, timeEntryId, {
      startTime,
      endTime: effectiveEndTime,
      duration,
      ...(description !== undefined && { description }),
    });
    return updatedTimeEntry;
  });
}

export default updateTimeEntry;
