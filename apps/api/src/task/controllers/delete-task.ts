import { eq, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskRelationTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteS3Keys, getTaskAssetKeys } from "../../storage/cleanup-assets";
import { lockTaskAndAssertProjectLive } from "../assert-task-project-live";

async function deleteTask(taskId: string, currentUserId: string) {
  const { relations, assetKeys, deletedTask } = await db.transaction(
    async (tx) => {
      await lockTaskAndAssertProjectLive(tx, taskId);
      const relations = await tx
        .select()
        .from(taskRelationTable)
        .where(
          or(
            eq(taskRelationTable.sourceTaskId, taskId),
            eq(taskRelationTable.targetTaskId, taskId),
          ),
        )
        .execute();
      const assetKeys = await getTaskAssetKeys(taskId);
      const [deletedTask] = await tx
        .delete(taskTable)
        .where(eq(taskTable.id, taskId))
        .returning()
        .execute();
      return { relations, assetKeys, deletedTask };
    },
  );

  if (!deletedTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // The returned deleted row is the authoritative locked snapshot for both
  // response and event attribution; no unlocked preflight data is reused.

  await publishEvent("task.deleted", {
    taskId: deletedTask.id,
    projectId: deletedTask.projectId,
    userId: currentUserId,
    title: deletedTask.title,
  });

  for (const relation of relations) {
    await publishEvent("task-relation.deleted", {
      projectId: deletedTask.projectId,
      userId: currentUserId,
      taskId: taskId,
      sourceTaskId: relation.sourceTaskId,
      targetTaskId: relation.targetTaskId,
    });
  }

  // Fire-and-forget S3 cleanup after successful DB delete
  if (assetKeys.length > 0) {
    deleteS3Keys(assetKeys).catch(() => {});
  }

  return deletedTask;
}

export default deleteTask;
