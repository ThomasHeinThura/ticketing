import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { resolveDuration } from "../duration";
import {
  findTimeEntryById,
  lockTaskAndAssertProjectLive,
  updateTimeEntryById,
} from "../repository";

type UpdateTimeEntryParams = {
  identity: ResolvedIdentity;
  timeEntryId: string;
  startTime: Date;
  endTime?: Date;
  description?: string;
};

async function updateTimeEntry(params: UpdateTimeEntryParams) {
  const { identity, timeEntryId, startTime, endTime, description } = params;
  const existingTimeEntry = await findTimeEntryById(identity, timeEntryId);
  if (!existingTimeEntry) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }

  const effectiveEndTime = endTime ?? existingTimeEntry.endTime;
  const updatedTimeEntry = await db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, identity, existingTimeEntry.taskId);
    const duration = resolveDuration(startTime, effectiveEndTime ?? undefined);
    return updateTimeEntryById(tx, identity, timeEntryId, {
      startTime,
      endTime: effectiveEndTime,
      duration,
      ...(description !== undefined && { description }),
    });
  });
  if (!updatedTimeEntry) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }
  return updatedTimeEntry;
}

export default updateTimeEntry;
