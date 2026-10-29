import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectFeatureEnabled } from "../../feature-flag/enforce";
import { isServicePrincipalId } from "../../permissions/service-principal";
import {
  assertCallerHasCapabilityOrOwner,
  type CapabilityCredential,
} from "../../utils/require-workspace-capability";
import { resolveDuration } from "../duration";
import {
  findTimeEntryMutationTarget,
  lockTaskAndAssertProjectLive,
  lockTimeEntryForUpdate,
  updateTimeEntryById,
} from "../repository";

type UpdateTimeEntryParams = {
  identity: ResolvedIdentity;
  credential: CapabilityCredential;
  timeEntryId: string;
  startTime: Date;
  endTime?: Date;
  description?: string;
};

async function updateTimeEntry(params: UpdateTimeEntryParams) {
  const { identity, credential, timeEntryId, startTime, endTime, description } =
    params;
  if (identity.side !== "staff" || isServicePrincipalId(identity.userId))
    throw new HTTPException(403, { message: "Forbidden" });
  const target = await findTimeEntryMutationTarget(identity, timeEntryId);
  if (!target) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }

  const updatedTimeEntry = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(
      tx,
      identity,
      target.taskId,
    );
    const existingTimeEntry = await lockTimeEntryForUpdate(
      tx,
      identity,
      timeEntryId,
      target.taskId,
    );
    if (!existingTimeEntry) {
      throw new HTTPException(404, { message: "Time entry not found" });
    }
    await assertCallerHasCapabilityOrOwner(
      task.workspaceId,
      identity.userId,
      "time_entry:update_any",
      "time_entry:update_own",
      existingTimeEntry.ownerPersonId === identity.personId,
      credential,
      tx,
    );
    if (
      !(await projectFeatureEnabled(
        "feature.time_tracking",
        task.projectId,
        tx,
      ))
    )
      throw new HTTPException(409, { message: "feature_disabled" });
    const effectiveEndTime = endTime ?? existingTimeEntry.endTime;
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
