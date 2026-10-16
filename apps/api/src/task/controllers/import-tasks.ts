import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { insertRequiredTaskActivity } from "../../activity/repository";
import db from "../../database";
import { publishEvent } from "../../events";
import {
  assertAssignableUserAndLockMembership,
  filterAssignableUsers,
} from "../../utils/assert-assignable-user";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { lockProjectAndAssertLiveForTaskNumberForIdentity } from "../assert-task-project-live";
import {
  findColumnBySlugForIdentity,
  findProjectById,
  insertTask,
} from "../repository";
import {
  coercePriority,
  coerceStatus,
  getValidTaskStatuses,
} from "../validate-task-fields";
import { claimTaskNumberForIdentity } from "./claim-task-numbers";

export type ImportTask = {
  title: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
};

async function importTasks(
  identity: ResolvedIdentity,
  projectId: string,
  tasksToImport: ImportTask[],
  currentUserId?: string,
) {
  const project = await db.transaction(async (tx) => {
    await lockProjectAndAssertLiveForTaskNumberForIdentity(
      tx,
      projectId,
      identity,
      "Project not found",
    );
    const liveProject = await findProjectById(tx, identity, projectId);

    if (!liveProject) {
      throw new HTTPException(404, { message: "Project not found" });
    }

    return liveProject;
  });

  const assigneeIds = [
    ...new Set(
      tasksToImport
        .map((task) => task.userId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (assigneeIds.some((assigneeId) => assigneeId.includes("\u0000"))) {
    await db.transaction(async (tx) => {
      await lockProjectAndAssertLiveForTaskNumberForIdentity(
        tx,
        projectId,
        identity,
        "Project not found",
      );
      for (const assigneeId of assigneeIds) {
        rejectNulByte(assigneeId, "Assignee id");
      }
    });
  }
  // S5 (Opus review of PR #307, delta round): reaches `filterAssignableUsers`'s
  // `inArray(workspaceUserTable.userId, ...)` query below unvalidated -- a NUL
  // byte would otherwise 500 instead of a clean 400.
  const assignableIds = await filterAssignableUsers(
    assigneeIds,
    project.workspaceId,
  );

  const validStatuses = await getValidTaskStatuses(identity, projectId, db);

  const results = [];

  for (const taskData of tasksToImport) {
    const assigneeId = taskData.userId?.trim() || null;

    if (assigneeId && !assignableIds.has(assigneeId)) {
      results.push({
        success: false,
        error: "Assignee is not a member of this workspace",
        task: taskData,
      });
      continue;
    }

    try {
      const { status, warning: statusWarning } = coerceStatus(
        taskData.status,
        validStatuses,
      );
      const { priority, warning: priorityWarning } = coercePriority(
        taskData.priority || "low",
      );
      const warnings = [statusWarning, priorityWarning].filter(Boolean);

      const column = await findColumnBySlugForIdentity(
        db,
        identity,
        projectId,
        status,
      );

      const createdTask = await db.transaction(async (tx) => {
        await lockProjectAndAssertLiveForTaskNumberForIdentity(
          tx,
          projectId,
          identity,
          "Project not found",
        );
        if (assigneeId) {
          await assertAssignableUserAndLockMembership(
            assigneeId,
            project.workspaceId,
            tx,
          );
        }
        const taskNumber = await claimTaskNumberForIdentity(
          identity,
          projectId,
          tx,
        );

        const task = await insertTask(tx, identity, {
          projectId,
          userId: assigneeId,
          title: taskData.title,
          status,
          columnId: column?.id ?? null,
          startDate: taskData.startDate ? new Date(taskData.startDate) : null,
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
          description: taskData.description || "",
          priority,
          number: taskNumber,
        });

        // Preserve the existing task.created subscriber's missing-actor guard.
        if (task && currentUserId) {
          await insertRequiredTaskActivity(tx, identity, {
            taskId: task.id,
            type: "create",
            userId: currentUserId,
            content: null,
            eventData: {},
          });
        }

        return task;
      });

      if (createdTask) {
        await publishEvent("task.created", {
          ...createdTask,
          taskId: createdTask.id,
          userId: createdTask.userId ?? "",
          currentUserId: currentUserId ?? "",
          type: "create",
          content: "imported the task",
        });

        results.push({
          success: true,
          task: createdTask,
          ...(warnings.length > 0 && { warnings }),
        });
      } else {
        results.push({
          success: false,
          error: "Failed to create task",
          task: taskData,
        });
      }
    } catch (error) {
      if (
        error instanceof HTTPException &&
        error.status === 404 &&
        error.message === "Project not found"
      ) {
        results.push({
          success: false,
          error: "Project is no longer available",
          task: taskData,
        });
        continue;
      }
      if (
        error instanceof HTTPException &&
        error.status === 403 &&
        error.message === "Assignee is not a member of this workspace"
      ) {
        results.push({
          success: false,
          error: error.message,
          task: taskData,
        });
        continue;
      }
      if (error instanceof HTTPException) throw error;
      results.push({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        task: taskData,
      });
    }
  }

  return {
    importedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
    },
    results: {
      total: tasksToImport.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      tasks: results,
    },
  };
}

export default importTasks;
