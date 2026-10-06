import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";
import {
  lockLegacyTaskRowQuery,
  lockProjectForTaskNumberQuery,
} from "./repository";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Legacy task writes lock the task first so a concurrent move cannot change which
 * project must be checked. The exclusive row lock also serializes same-task writes
 * without share-to-update lock upgrades. The caller must keep the returned task,
 * project liveness check and write inside this same transaction.
 */
export async function lockLegacyTaskRow(tx: DbOrTx, taskId: string) {
  const task = await lockLegacyTaskRowIfPresent(tx, taskId);

  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  return task;
}

export async function lockLegacyTaskRowIfPresent(tx: DbOrTx, taskId: string) {
  const [task] = await lockLegacyTaskRowQuery(tx, taskId);
  return task;
}

export async function lockTaskAndAssertProjectLive(tx: DbOrTx, taskId: string) {
  const task = await lockLegacyTaskRow(tx, taskId);
  await assertProjectStillLive(tx, task.projectId, "Task not found");
  return task;
}

export async function lockProjectsAndAssertLive(
  tx: DbOrTx,
  projectIds: string[],
  taskNumberProjectIds: string[] = [],
  projectNotFoundMessages: ReadonlyMap<string, string> = new Map(),
) {
  const numberProjectIds = new Set(taskNumberProjectIds);
  for (const projectId of [...new Set(projectIds)].sort()) {
    const projectNotFoundMessage =
      projectNotFoundMessages.get(projectId) ?? "Task not found";
    if (numberProjectIds.has(projectId)) {
      await lockProjectAndAssertLiveForTaskNumber(
        tx,
        projectId,
        projectNotFoundMessage,
      );
    } else {
      await assertProjectStillLive(tx, projectId, projectNotFoundMessage);
    }
  }
}

/**
 * Task creation and moves update `project.lastTaskNumber` immediately after the
 * liveness check. Acquire the same row exclusively here so concurrent callers
 * serialize before `claimTaskNumber` rather than upgrading compatible `FOR SHARE`
 * locks into conflicting updates.
 */
export async function lockProjectAndAssertLiveForTaskNumber(
  tx: DbOrTx,
  projectId: string,
  projectNotFoundMessage = "Task not found",
) {
  const [project] = await lockProjectForTaskNumberQuery(tx, projectId);

  if (!project) {
    throw new HTTPException(404, { message: projectNotFoundMessage });
  }
}
