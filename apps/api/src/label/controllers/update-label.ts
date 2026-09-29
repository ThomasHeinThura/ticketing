import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable } from "../../database/schema";
import {
  lockLegacyTaskRow,
  lockProjectsAndAssertLive,
  lockTaskAndAssertProjectLive,
} from "../../task/assert-task-project-live";

async function updateLabel(id: string, name: string, color: string) {
  const labelSnapshot = await db.query.labelTable.findFirst({
    where: eq(labelTable.id, id),
  });
  if (!labelSnapshot) {
    throw new HTTPException(404, { message: "Label not found" });
  }

  return db.transaction(async (tx) => {
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

    if (label.taskId !== labelSnapshot.taskId) {
      throw new HTTPException(409, {
        message: "Label assignment changed; retry the request",
      });
    }

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
        tasks.push(await lockLegacyTaskRow(tx, taskId));
      }
      await lockProjectsAndAssertLive(
        tx,
        tasks.map((task) => task.projectId),
      );
    }

    const [updatedLabel] = await tx
      .update(labelTable)
      .set({ name, color })
      .where(eq(labelTable.id, id))
      .returning();

    // If this is a workspace-level label, cascade the changes to all
    // task-level copies so existing label assignments reflect the new color/name
    if (!label.taskId && label.workspaceId) {
      await tx
        .update(labelTable)
        .set({ name, color })
        .where(
          and(
            eq(labelTable.workspaceId, label.workspaceId),
            eq(labelTable.name, label.name),
            isNotNull(labelTable.taskId),
          ),
        );
    }

    return updatedLabel;
  });
}

export default updateLabel;
