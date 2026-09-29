import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { projectTable, taskTable } from "../database/schema";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Legacy task writes lock the task first so a concurrent move cannot change which
 * project must be checked. The exclusive row lock also serializes same-task writes
 * without share-to-update lock upgrades. The caller must keep the returned task,
 * project liveness check and write inside this same transaction.
 */
export async function lockLegacyTaskRow(tx: DbOrTx, taskId: string) {
  const [task] = await tx
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .for("update");

  if (!task) {
    throw new HTTPException(404, { message: "Task not found" });
  }

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
) {
  const numberProjectIds = new Set(taskNumberProjectIds);
  for (const projectId of [...new Set(projectIds)].sort()) {
    if (numberProjectIds.has(projectId)) {
      await lockProjectAndAssertLiveForTaskNumber(tx, projectId);
    } else {
      await assertProjectStillLive(tx, projectId, "Task not found");
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
) {
  const [project] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    )
    .for("update");

  if (!project) {
    throw new HTTPException(404, { message: "Task not found" });
  }
}
