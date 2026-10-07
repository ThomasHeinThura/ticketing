import { and, eq, inArray, like } from "drizzle-orm";
import type db from "../database";
import {
  assetTable,
  taskActivityTable,
  taskCommentTable,
  taskTable,
} from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function getAssetDescriptionReference(
  executor: Executor,
  taskId: string,
  pattern: string,
) {
  return executor
    .select({ description: taskTable.description })
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), like(taskTable.description, pattern)))
    .limit(1);
}

export function listAssetCommentReferences(
  executor: Executor,
  taskId: string,
  pattern: string,
) {
  return executor
    .select({ content: taskCommentTable.content })
    .from(taskCommentTable)
    .where(
      and(
        eq(taskCommentTable.taskId, taskId),
        like(taskCommentTable.content, pattern),
      ),
    );
}

export function listAssetActivityReferences(
  executor: Executor,
  taskId: string,
  pattern: string,
) {
  return executor
    .select({ content: taskActivityTable.content })
    .from(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.taskId, taskId),
        like(taskActivityTable.content, pattern),
      ),
    );
}

export function listAssetsForTask(
  executor: Executor,
  taskId: string,
  removedIds: string[],
) {
  return executor
    .select({ id: assetTable.id, objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(
      and(inArray(assetTable.id, removedIds), eq(assetTable.taskId, taskId)),
    );
}

export function listAssetKeys(executor: Executor, taskId: string) {
  return executor
    .select({ objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(eq(assetTable.taskId, taskId));
}
