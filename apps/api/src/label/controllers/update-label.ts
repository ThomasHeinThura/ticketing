import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable } from "../../database/schema";
import {
  lockLegacyTaskRowIfPresent,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";
import { lockWorkspaceLabelNames } from "../label-name-lock";

async function updateLabel(id: string, name: string, color: string) {
  const labelSnapshot = await db.query.labelTable.findFirst({
    where: eq(labelTable.id, id),
  });
  if (!labelSnapshot) {
    throw new HTTPException(404, { message: "Label not found" });
  }

  return db.transaction(async (tx) => {
    await lockWorkspaceLabelNames(tx, labelSnapshot.workspaceId, [
      labelSnapshot.name,
      name,
    ]);
    if (labelSnapshot.taskId) {
      await lockTaskAndAssertProjectLive(tx, labelSnapshot.taskId);
    }
    const [label] = await tx
      .select()
      .from(labelTable)
      .where(eq(labelTable.id, id))
      .for("update");

    if (!label) {
      throw new HTTPException(404, {
        message: "Label not found",
      });
    }

    if (
      label.taskId !== labelSnapshot.taskId ||
      label.workspaceId !== labelSnapshot.workspaceId ||
      label.name !== labelSnapshot.name
    ) {
      throw new HTTPException(409, {
        message: "Label changed; retry the request",
      });
    }

    let remainingCopyIds: string[] = [];
    if (!label.taskId && label.workspaceId) {
      const copies = await tx
        .select({ taskId: labelTable.taskId })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, label.workspaceId),
            eq(labelTable.name, label.name),
            isNotNull(labelTable.taskId),
          ),
        );
      const taskIds = [
        ...new Set(
          copies
            .map((copy) => copy.taskId)
            .filter((taskId): taskId is string => Boolean(taskId)),
        ),
      ].sort();
      const tasks = [];
      for (const taskId of taskIds) {
        const task = await lockLegacyTaskRowIfPresent(tx, taskId);
        if (task) tasks.push(task);
      }
      await lockProjectsAndAssertLive(
        tx,
        tasks.map((task) => task.projectId),
      );
      const lockedTaskIds = tasks.map((task) => task.id);
      const remainingCopies = lockedTaskIds.length
        ? await tx
            .select({ id: labelTable.id })
            .from(labelTable)
            .where(
              and(
                eq(labelTable.workspaceId, label.workspaceId),
                eq(labelTable.name, label.name),
                isNotNull(labelTable.taskId),
                inArray(labelTable.taskId, lockedTaskIds),
              ),
            )
            .orderBy(asc(labelTable.taskId), asc(labelTable.id))
            .for("update")
        : [];
      remainingCopyIds = remainingCopies.map((copy) => copy.id);
    }

    const [updatedLabel] = await tx
      .update(labelTable)
      .set({ name, color })
      .where(eq(labelTable.id, id))
      .returning();

    if (remainingCopyIds.length > 0) {
      await tx
        .update(labelTable)
        .set({ name, color })
        .where(inArray(labelTable.id, remainingCopyIds));
    }

    return updatedLabel;
  });
}

export default updateLabel;
