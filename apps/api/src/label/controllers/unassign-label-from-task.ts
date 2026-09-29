import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { labelTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";

async function unassignLabelFromTask(id: string, userId: string) {
  const { deletedLabel, task } = await db.transaction(async (tx) => {
    const [label] = await tx
      .select()
      .from(labelTable)
      .where(eq(labelTable.id, id))
      .for("update");
    if (!label) {
      throw new HTTPException(404, { message: "Label not found" });
    }
    if (!label.taskId) {
      throw new HTTPException(400, {
        message: "Label is not assigned to a task",
      });
    }
    const lockedTask = await lockTaskAndAssertProjectLive(tx, label.taskId);
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

  if (deletedLabel.taskId) {
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
