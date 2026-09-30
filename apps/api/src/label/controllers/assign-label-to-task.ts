import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  labelTable,
  type labelTable as labelTableType,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
} from "../../task/assert-task-project-live";
import { rejectNulByte } from "../../utils/reject-nul-byte";
import { lockWorkspaceLabelNames } from "../label-name-lock";

type LabelRow = typeof labelTableType.$inferSelect;

async function assignLabelToTask(id: string, taskId: string, userId: string) {
  // #290 S4 sweep: `taskId` is a body field on `attachLabelToTaskRoute`, not covered
  // by `workspaceAccess.fromLabel()` (which only guards `id`) -- a NUL byte here
  // reached `eq(taskTable.id, taskId)` unvalidated and 500'd.
  rejectNulByte(taskId, "Task id");

  const label = await db.query.labelTable.findFirst({
    where: (label, { eq }) => eq(label.id, id),
  });

  if (!label) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  // `workspaceAccess.fromLabel()` (this route's own middleware) already resolved
  // and reach-checked this label's workspace before this controller ever ran --
  // `lookupWorkspaceId` treats a null `workspaceId` column the same as "row
  // doesn't exist" (`|| null`), so reaching here means it is a real string.
  if (!label.workspaceId) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  // S2 (Opus review of PR #307, delta round): scoped to the label's own
  // (already reach-checked) workspace in the query itself, so a `taskId`
  // belonging to ANOTHER workspace is indistinguishable from a nonexistent one --
  // both now 404 `Task not found` here, instead of a nonexistent id 404ing while
  // a foreign id resolved and then 400'd "must belong to the same workspace",
  // which is the #290/#285 existence-oracle class applied to task ids.
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        eq(projectTable.workspaceId, label.workspaceId),
      ),
    )
    .limit(1);

  if (!task) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  type InsertionResult = {
    taskLabel: LabelRow;
    inserted: boolean;
    task: { id: string; projectId: string };
  };
  const {
    taskLabel,
    inserted,
    task: taskContext,
  } = await db.transaction<InsertionResult>(async (tx) => {
    await lockWorkspaceLabelNames(tx, label.workspaceId, [label.name]);
    // Task-scoped labels follow task -> label lock order so task deletion's
    // cascading child-row delete cannot deadlock against a label edit/move.
    // Workspace labels remain label -> task: workspace-label cascades take the
    // base label first, and task deletion never needs that base row.
    const taskIds = [taskId, label.taskId]
      .filter((value): value is string => Boolean(value))
      .sort();
    const lockedTasks = new Map<
      string,
      Awaited<ReturnType<typeof lockLegacyTaskRow>>
    >();
    let currentLabel: LabelRow | undefined;
    if (!label.taskId) {
      [currentLabel] = await tx
        .select()
        .from(labelTable)
        .where(eq(labelTable.id, id))
        .for("update");
    }
    if (!currentLabel && !label.taskId) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    for (const currentTaskId of taskIds) {
      lockedTasks.set(
        currentTaskId,
        await lockLegacyTaskRow(tx, currentTaskId),
      );
    }
    if (label.taskId) {
      [currentLabel] = await tx
        .select()
        .from(labelTable)
        .where(eq(labelTable.id, id))
        .for("update");
    }
    if (!currentLabel) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    if (
      currentLabel.workspaceId !== label.workspaceId ||
      currentLabel.name !== label.name
    ) {
      throw new HTTPException(409, {
        message: "Label changed; retry the request",
      });
    }
    if (currentLabel.taskId && !lockedTasks.has(currentLabel.taskId)) {
      throw new HTTPException(409, {
        message: "Label assignment changed; retry the request",
      });
    }

    const lockedTargetTask = lockedTasks.get(taskId);
    if (!lockedTargetTask) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    const projectIds = [...lockedTasks.values()].map((row) => row.projectId);
    await lockProjectsAndAssertLive(tx, projectIds);
    const projects = await tx
      .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
      .from(projectTable)
      .where(inArray(projectTable.id, projectIds));
    const lockedTargetProject = projects.find(
      (project) => project.id === lockedTargetTask.projectId,
    );
    if (
      !lockedTargetProject ||
      lockedTargetProject.workspaceId !== currentLabel.workspaceId
    ) {
      throw new HTTPException(400, {
        message: "Label and task must belong to the same workspace",
      });
    }

    const task = {
      id: lockedTargetTask.id,
      projectId: lockedTargetTask.projectId,
      workspaceId: lockedTargetProject.workspaceId,
    };

    if (currentLabel.taskId === taskId) {
      return {
        taskLabel: currentLabel,
        inserted: false,
        task,
      };
    }

    const previousTaskId = currentLabel.taskId;
    if (previousTaskId) {
      await tx.delete(labelTable).where(eq(labelTable.id, id));
    }

    const [insertedRow] = await tx
      .insert(labelTable)
      .values({
        name: currentLabel.name,
        color: currentLabel.color,
        taskId,
        workspaceId: task.workspaceId,
      })
      .onConflictDoNothing({
        target: [labelTable.taskId, labelTable.name],
      })
      .returning();

    if (insertedRow) {
      return {
        taskLabel: insertedRow,
        inserted: true,
        task,
      };
    }

    const existing = await tx.query.labelTable.findFirst({
      where: and(
        eq(labelTable.taskId, taskId),
        eq(labelTable.name, currentLabel.name),
      ),
    });

    if (!existing) {
      throw new HTTPException(500, {
        message: "Failed to attach label to task",
      });
    }

    return {
      taskLabel: existing,
      inserted: false,
      task,
    };
  });

  if (!inserted) {
    return taskLabel;
  }

  await publishEvent("task.label_assigned", {
    label: taskLabel,
    task,
    projectId: taskContext.projectId,
    taskId: taskContext.id,
    userId,
    type: "label_assigned",
  });

  return taskLabel;
}

export default assignLabelToTask;
