import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { insertRequiredTaskActivity } from "../../activity/repository";
import db from "../../database";
import { publishEvent } from "../../events";
import {
  assertAssignableUserAndLockMembership,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import {
  validateAndParseDate,
  validateDateRange,
} from "../../utils/validate-dates";
import { lockProjectAndAssertLiveForTaskNumberForIdentity } from "../assert-task-project-live";
import {
  findColumnBySlugForIdentity,
  findMaxTaskPositionInColumnOrStatus,
  findUserName,
  insertTask,
} from "../repository";
import { assertValidTaskStatus } from "../validate-task-fields";
import { claimTaskNumberForIdentity } from "./claim-task-numbers";

async function createTask({
  identity,
  projectId,
  currentUserId,
  userId,
  title,
  status,
  startDate,
  dueDate,
  description,
  priority,
}: {
  identity: ResolvedIdentity;
  projectId: string;
  currentUserId: string;
  userId?: string;
  title: string;
  status: string;
  startDate?: string;
  dueDate?: string;
  description?: string;
  priority?: string;
}) {
  const resolvedStatus = status || "to-do";
  const resolvedPriority = priority || "no-priority";

  const normalizedUserId = userId?.trim() || undefined;
  const { task: createdTask, assigneeName } = await db.transaction(
    async (tx) => {
      await lockProjectAndAssertLiveForTaskNumberForIdentity(
        tx,
        projectId,
        identity,
      );
      // Check request fields after the project freeze lock so a frozen board stays read-only.
      const parsedStartDate =
        startDate !== undefined
          ? validateAndParseDate(startDate, "startDate")
          : undefined;
      const parsedDueDate =
        dueDate !== undefined
          ? validateAndParseDate(dueDate, "dueDate")
          : undefined;
      validateDateRange(parsedStartDate, parsedDueDate);
      if (normalizedUserId) {
        rejectNulByte(normalizedUserId, "Assignee id");
      }
      const workspaceId = await getProjectWorkspaceId(projectId, tx);
      await assertValidTaskStatus(identity, resolvedStatus, projectId, tx);

      let assignee: { name: string } | undefined;
      if (normalizedUserId) {
        await assertAssignableUserAndLockMembership(
          normalizedUserId,
          workspaceId,
          tx,
        );

        assignee = await findUserName(
          identity,
          normalizedUserId,
          projectId,
          tx,
        );
      }

      const column = await findColumnBySlugForIdentity(
        tx,
        identity,
        projectId,
        resolvedStatus,
      );
      const maxPositionResult = await findMaxTaskPositionInColumnOrStatus(
        tx,
        identity,
        projectId,
        resolvedStatus,
        column?.id,
      );
      const nextPosition = (maxPositionResult?.maxPosition ?? 0) + 1;

      const taskNumber = await claimTaskNumberForIdentity(
        identity,
        projectId,
        tx,
      );

      const task = await insertTask(tx, identity, {
        projectId,
        userId: normalizedUserId ?? null,
        title: title || "",
        status: resolvedStatus,
        columnId: column?.id ?? null,
        startDate: parsedStartDate || null,
        dueDate: parsedDueDate || null,
        description: description || "",
        priority: resolvedPriority,
        number: taskNumber,
        position: nextPosition,
      });

      if (task) {
        await insertRequiredTaskActivity(tx, identity, {
          taskId: task.id,
          type: "created",
          userId: currentUserId,
          content: null,
          eventData: {},
        });
      }

      return { task, assigneeName: assignee?.name };
    },
  );

  if (!createdTask) {
    throw new HTTPException(500, {
      message: "Failed to create task",
    });
  }

  await publishEvent("task.created", {
    ...createdTask,
    taskId: createdTask.id,
    userId: createdTask.userId ?? "",
    currentUserId: currentUserId,
    type: "created",
    content: null,
  });

  return {
    ...createdTask,
    assigneeName,
  };
}

export default createTask;
