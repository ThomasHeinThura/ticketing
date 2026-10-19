import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  like,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  assetTable,
  projectTable,
  taskActivityTable,
  taskCommentTable,
  taskTable,
} from "../database/schema";

function taskReach(
  identity: ResolvedIdentity,
  taskId: SQLWrapper,
  executor: Executor,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, taskId),
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            executor,
          ),
        ),
      ),
  );
}

export async function findTaskDescriptionLike(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  pattern: string,
) {
  const [task] = await executor
    .select({ description: taskTable.description })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        like(taskTable.description, pattern),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .limit(1);
  return task;
}

export async function listTaskCommentContentsLike(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  pattern: string,
) {
  return executor
    .select({ content: taskCommentTable.content })
    .from(taskCommentTable)
    .innerJoin(taskTable, eq(taskCommentTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        like(taskCommentTable.content, pattern),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
}

export async function listTaskActivityContentsLike(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  pattern: string,
) {
  return executor
    .select({ content: taskActivityTable.content })
    .from(taskActivityTable)
    .innerJoin(taskTable, eq(taskActivityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        like(taskActivityTable.content, pattern),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
}

/** Return only this task's assets when its current persisted project reach still holds. */
export async function listTaskAssetsByIds(
  executor: Executor,
  identity: ResolvedIdentity,
  assetIds: readonly string[],
  taskId: string,
) {
  if (assetIds.length === 0) return [];
  return executor
    .select({ id: assetTable.id, objectKey: assetTable.objectKey })
    .from(assetTable)
    .innerJoin(taskTable, eq(assetTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(assetTable.id, [...assetIds]),
        eq(taskTable.id, taskId),
        eq(assetTable.projectId, projectTable.id),
        eq(assetTable.workspaceId, projectTable.workspaceId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
}

/** Delete only returned asset ids that still belong to this reachable task. */
export async function deleteAssetsByIds(
  executor: Executor,
  identity: ResolvedIdentity,
  assetIds: readonly string[],
  taskId: string,
) {
  if (assetIds.length === 0) return [];
  return executor
    .delete(assetTable)
    .where(
      and(
        inArray(assetTable.id, [...assetIds]),
        eq(assetTable.taskId, taskId),
        taskReach(identity, assetTable.taskId, executor),
      ),
    )
    .returning({ id: assetTable.id });
}

export async function listTaskAssetObjectKeys(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const rows = await executor
    .select({ objectKey: assetTable.objectKey })
    .from(assetTable)
    .innerJoin(taskTable, eq(assetTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        eq(assetTable.projectId, projectTable.id),
        eq(assetTable.workspaceId, projectTable.workspaceId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  return rows;
}
