import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { lockWorkspaceLabelNames } from "../label-name-lock";

async function unassignLabelFromTask(id: string, userId: string) {
  const { deletedLabel, task } = await db.transaction(async (tx) => {
    const [labelSnapshot] = await tx
      .select({
        taskId: labelTable.taskId,
        workspaceId: labelTable.workspaceId,
        name: labelTable.name,
      })
      .from(labelTable)
      .where(eq(labelTable.id, id))
      .limit(1);
    if (!labelSnapshot) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    if (!labelSnapshot.taskId) {
      throw new HTTPException(400, {
        message: "Label is not assigned to a task",
      });
    }

    await lockWorkspaceLabelNames(tx, labelSnapshot.workspaceId, [
      labelSnapshot.name,
    ]);

    // Match task deletion's task -> child-row lock order. A stale snapshot is
    // rejected below instead of taking a second task lock after the label lock.
    const lockedTask = await lockTaskAndAssertProjectLive(
      tx,
      labelSnapshot.taskId,
    );
    const [label] = await tx
      .select()
      .from(labelTable)
      .where(eq(labelTable.id, id))
      .for("update");
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
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

    const [deletedLabel] = await tx
      .delete(labelTable)
      .where(eq(labelTable.id, id))
      .returning();
    return {
      deletedLabel,
      task: {
        id: lockedTask.id,
        projectId: lockedTask.projectId,
      },
    };
  });

  if (!deletedLabel) {
    throw new HTTPException(500, {
      message: "Failed to detach label from task",
    });
  }

  await publishEvent("task.label_unassigned", {
    label: deletedLabel,
    task,
    projectId: task.projectId,
    taskId: deletedLabel.taskId,
    userId,
    type: "label_unassigned",
  });

  return deletedLabel;
}

export default unassignLabelFromTask;
