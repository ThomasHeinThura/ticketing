import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";

async function deleteLabel(id: string, userId: string) {
  const labelSnapshot = await db.query.labelTable.findFirst({
    where: eq(labelTable.id, id),
  });
  if (!labelSnapshot) {
    throw new HTTPException(404, { message: "Label not found" });
  }

  const result = await db.transaction(async (tx) => {
    let lockedTask: Awaited<ReturnType<typeof lockLegacyTaskRow>> | undefined;
    if (labelSnapshot.taskId) {
      lockedTask = await lockTaskAndAssertProjectLive(tx, labelSnapshot.taskId);
    }
    const [label] = await tx
      .select()
      .from(labelTable)
      .where(eq(labelTable.id, id))
      .for("update");
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
    }

    if (label.taskId !== labelSnapshot.taskId) {
      throw new HTTPException(409, {
        message: "Label assignment changed; retry the request",
      });
    }

    if (label.taskId) {
      if (!lockedTask) {
        throw new HTTPException(404, { message: "Task not found" });
      }
      const [deletedLabel] = await tx
        .delete(labelTable)
        .where(eq(labelTable.id, id))
        .returning();
      if (!deletedLabel) {
        throw new HTTPException(404, { message: "Label not found" });
      }
      return {
        deletedLabel,
        affectedLabels: [
          {
            label: deletedLabel,
            taskId: lockedTask.id,
            projectId: lockedTask.projectId,
          },
        ],
      };
    }

    const affectedLabels = label.workspaceId
      ? await tx
          .select({
            label: labelTable,
            taskId: taskTable.id,
            projectId: taskTable.projectId,
          })
          .from(labelTable)
          .innerJoin(taskTable, eq(labelTable.taskId, taskTable.id))
          .where(
            and(
              eq(labelTable.workspaceId, label.workspaceId),
              eq(labelTable.name, label.name),
              isNotNull(labelTable.taskId),
            ),
          )
      : [];
    const taskIds = [
      ...new Set(affectedLabels.map((entry) => entry.taskId)),
    ].sort();
    const tasks = new Map<
      string,
      Awaited<ReturnType<typeof lockLegacyTaskRow>>
    >();
    for (const taskId of taskIds) {
      tasks.set(taskId, await lockLegacyTaskRow(tx, taskId));
    }
    await lockProjectsAndAssertLive(
      tx,
      [...tasks.values()].map((task) => task.projectId),
    );

    const [deletedLabel] = await tx
      .delete(labelTable)
      .where(eq(labelTable.id, id))
      .returning();
    if (!deletedLabel) {
      throw new HTTPException(404, { message: "Label not found" });
    }

    if (label.workspaceId) {
      await tx
        .delete(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, label.workspaceId),
            eq(labelTable.name, label.name),
            isNotNull(labelTable.taskId),
          ),
        );
    }

    const emittedRows = affectedLabels.map(({ label: child, taskId }) => {
      const task = tasks.get(taskId);
      if (!task) throw new HTTPException(404, { message: "Task not found" });
      return { label: child, taskId, projectId: task.projectId };
    });
    return {
      deletedLabel,
      affectedLabels: emittedRows,
    };
  });

  for (const { label, taskId, projectId } of result.affectedLabels) {
    await publishEvent("task.label_deleted", {
      label,
      task: { id: taskId, projectId },
      projectId,
      taskId,
      userId,
      type: "label_deleted",
    });
  }

  return result.deletedLabel;
}

export default deleteLabel;
