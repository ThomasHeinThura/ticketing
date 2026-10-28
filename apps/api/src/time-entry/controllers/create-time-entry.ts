import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import {
  dispatchLegacyTaskNotification,
  insertLegacyTaskNotification,
} from "../../events/legacy-task-effects";
import { findProjectWorkspaceId } from "../../notification/inbox.repository";
import { resolveDuration } from "../duration";
import { insertTimeEntry, lockTaskAndAssertProjectLive } from "../repository";

async function createTimeEntry({
  taskId,
  identity,
  userId,
  description,
  startTime,
  endTime,
  apiKeyId,
}: {
  taskId: string;
  identity: ResolvedIdentity;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  apiKeyId?: string | null;
}) {
  const { createdTimeEntry, task, notification } = await db.transaction(
    async (tx) => {
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
      const project = await findProjectWorkspaceId(task.projectId, tx);
      if (!project) throw new HTTPException(404, { message: "Task not found" });
      const eventId = createdTimeEntry
        ? await recordLegacyTaskCompatibilityEvent(tx, {
            kind: "time-entry.created",
            taskId,
            projectId: task.projectId,
            workspaceId: project.workspaceId,
            identity,
            apiKeyId,
            payload: {
              timeEntryId: createdTimeEntry.id,
              userId,
              type: "create",
            },
          })
        : null;
      const notification =
        eventId && task.userId && task.userId !== userId
          ? await insertLegacyTaskNotification(tx, {
              eventId,
              eventKind: "time-entry.created",
              userId: task.userId,
              type: "time_entry_created",
              taskId,
              projectId: task.projectId,
              eventData: { taskTitle: task.title },
            })
          : null;
      return { createdTimeEntry, task, notification };
    },
  );

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
  await dispatchLegacyTaskNotification(notification);

  return createdTimeEntry;
}

export default createTimeEntry;
