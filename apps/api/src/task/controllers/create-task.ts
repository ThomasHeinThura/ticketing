import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
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
import { lockProjectAndAssertLiveForTaskNumber } from "../assert-task-project-live";
import {
  findCurrentAssigneeNameQuery,
  findMaxTaskPositionQuery,
  findTaskColumnBySlugQuery,
} from "../repository";
import { assertValidTaskStatus } from "../validate-task-fields";
import { claimTaskNumber } from "./claim-task-numbers";

async function createTask({
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
      await lockProjectAndAssertLiveForTaskNumber(tx, projectId);
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
      await assertValidTaskStatus(resolvedStatus, projectId, tx);

      let assignee: { name: string } | undefined;
      if (normalizedUserId) {
        await assertAssignableUserAndLockMembership(
          normalizedUserId,
          workspaceId,
          tx,
        );

        [assignee] = await findCurrentAssigneeNameQuery(tx, normalizedUserId);
      }

      const column = await findTaskColumnBySlugQuery(
        tx,
        projectId,
        resolvedStatus,
      );
      const [maxPositionResult] = await findMaxTaskPositionQuery(
        tx,
        projectId,
        column?.id ?? null,
        resolvedStatus,
      );
      const nextPosition = (maxPositionResult?.maxPosition ?? 0) + 1;

      const taskNumber = await claimTaskNumber(projectId, tx);

      const [task] = await tx
        .insert(taskTable)
        .values({
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
        })
        .returning();

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
