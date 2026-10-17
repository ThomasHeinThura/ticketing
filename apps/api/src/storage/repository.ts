import { and, eq, inArray, like } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  assetTable,
  taskActivityTable,
  taskCommentTable,
  taskTable,
} from "../database/schema";

/**
 * Query ownership for asset clean-up (issue #580). Every function awaits and returns rows.
 * Reference lookups are scoped to one task; `pattern` is a LIKE pattern for the asset URL.
 */

export async function findTaskDescriptionLike(taskId: string, pattern: string) {
  const [taskRef] = await executorOrDefault()
    .select({ description: taskTable.description })
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), like(taskTable.description, pattern)))
    .limit(1);
  return taskRef;
}

export async function listTaskCommentContentsLike(
  taskId: string,
  pattern: string,
) {
  return executorOrDefault()
    .select({ content: taskCommentTable.content })
    .from(taskCommentTable)
    .where(
      and(
        eq(taskCommentTable.taskId, taskId),
        like(taskCommentTable.content, pattern),
      ),
    );
}

export async function listTaskActivityContentsLike(
  taskId: string,
  pattern: string,
) {
  return executorOrDefault()
    .select({ content: taskActivityTable.content })
    .from(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.taskId, taskId),
        like(taskActivityTable.content, pattern),
      ),
    );
}

/** The assets among `assetIds` that belong to the task. */
export async function listTaskAssetsByIds(assetIds: string[], taskId: string) {
  return executorOrDefault()
    .select({ id: assetTable.id, objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(
      and(inArray(assetTable.id, assetIds), eq(assetTable.taskId, taskId)),
    );
}

export async function deleteAssetsByIds(assetIds: string[]): Promise<void> {
  await executorOrDefault()
    .delete(assetTable)
    .where(inArray(assetTable.id, assetIds));
}

export async function listTaskAssetObjectKeys(
  taskId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({ objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(eq(assetTable.taskId, taskId));
}
