import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  labelTable,
  type labelTable as labelTableType,
  projectTable,
  taskTable,
} from "../database/schema";

/**
 * Label repository (issue #580). Every label statement lives here; the controllers keep the
 * transaction boundaries, lock order, publishEvent calls and error mapping. Statements are
 * moved verbatim: tenant predicates (workspace id / reachable project ids) stay in the SQL.
 */

export type LabelRow = typeof labelTableType.$inferSelect;

/**
 * Serialize writes to one workspace label family (the workspace row and all
 * task-level copies with the same name). Every family mutation takes these
 * transaction-scoped locks before taking label, task, or project row locks.
 * Names are sorted so a rename that holds both its old and new family cannot
 * deadlock with another rename that touches the same pair in reverse order.
 *
 * PostgreSQL hash collisions only cause unrelated labels to wait; they cannot
 * weaken the family lock. The workspace id is UUID-shaped in this schema, so
 * the colon delimiter is unambiguous for the family key. Namespace `4_007` is
 * distinct from the startup column-seed namespace `4_004`.
 */
export const WORKSPACE_LABEL_NAME_LOCK_NAMESPACE = 4_007;

export async function lockWorkspaceLabelNames(
  tx: Executor,
  workspaceId: string | null | undefined,
  names: string[],
) {
  if (!workspaceId) return;

  for (const name of [...new Set(names)].sort()) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_LABEL_NAME_LOCK_NAMESPACE}, hashtext(${`${workspaceId}:${name}`}))`,
    );
  }
}

/** A task with the workspace of its project, by task id (no workspace predicate). */
export async function findTaskWithWorkspace(
  taskId: string,
  executor?: Executor,
) {
  const [task] = await executorOrDefault(executor)
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task;
}

/** A task by id, only when its project belongs to `workspaceId` (tenant predicate in SQL). */
export async function findTaskInWorkspace(
  taskId: string,
  workspaceId: string,
  executor?: Executor,
) {
  const [task] = await executorOrDefault(executor)
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(eq(taskTable.id, taskId), eq(projectTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return task;
}

export async function findProjectWorkspaceId(
  executor: Executor,
  projectId: string,
) {
  const [project] = await executor
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId));
  return project;
}

export async function findProjectWorkspaces(
  executor: Executor,
  projectIds: string[],
) {
  return executor
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
}

export async function insertTaskLabelOnConflictDoNothing(
  executor: Executor,
  values: {
    name: string;
    color: string;
    taskId: string;
    workspaceId: string;
  },
) {
  const [inserted] = await executor
    .insert(labelTable)
    .values(values)
    .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] })
    .returning();
  return inserted;
}

export async function findTaskLabelByName(
  executor: Executor,
  taskId: string,
  name: string,
) {
  return executor.query.labelTable.findFirst({
    where: and(eq(labelTable.taskId, taskId), eq(labelTable.name, name)),
  });
}

export async function insertWorkspaceLabelOnConflictDoNothing(
  executor: Executor,
  values: { name: string; color: string; workspaceId: string },
) {
  const [inserted] = await executor
    .insert(labelTable)
    .values({ ...values, taskId: null })
    .onConflictDoNothing({
      target: [labelTable.workspaceId, labelTable.name],
      where: sql`${labelTable.taskId} is null`,
    })
    .returning();
  return inserted;
}

export async function findWorkspaceLabelByName(
  executor: Executor,
  workspaceId: string,
  name: string,
) {
  return executor.query.labelTable.findFirst({
    where: and(
      eq(labelTable.workspaceId, workspaceId),
      eq(labelTable.name, name),
      isNull(labelTable.taskId),
    ),
  });
}

export async function findLabelById(id: string, executor?: Executor) {
  return executorOrDefault(executor).query.labelTable.findFirst({
    where: (label, { eq }) => eq(label.id, id),
  });
}

export async function findLabelsByTaskId(taskId: string) {
  return executorOrDefault().query.labelTable.findMany({
    where: (label, { eq }) => eq(label.taskId, taskId),
  });
}

/**
 * The workspace's label list. A label DEFINITION (no task) is workspace-level and always
 * listed. A label bound to a task is listed only when that task's project is one of
 * `reachableProjectIds` (#740): a task-bound label names its task's project, so listing it for a
 * caller without reach to that project would disclose the task. The filter is in the SQL, so
 * a hidden label is never selected.
 */
export async function listLabelsByWorkspaceId(
  workspaceId: string,
  reachableProjectIds: readonly string[],
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  const reachableTask =
    reachableProjectIds.length === 0
      ? undefined
      : inArray(
          labelTable.taskId,
          db
            .select({ id: taskTable.id })
            .from(taskTable)
            .where(inArray(taskTable.projectId, [...reachableProjectIds])),
        );
  return await db
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        reachableTask
          ? or(isNull(labelTable.taskId), reachableTask)
          : isNull(labelTable.taskId),
      ),
    );
}

/** Unlocked snapshot of the columns the family locks are derived from. */
export async function findLabelSnapshot(executor: Executor, id: string) {
  const [labelSnapshot] = await executor
    .select({
      taskId: labelTable.taskId,
      workspaceId: labelTable.workspaceId,
      name: labelTable.name,
    })
    .from(labelTable)
    .where(eq(labelTable.id, id))
    .limit(1);
  return labelSnapshot;
}

export async function lockLabelRow(executor: Executor, id: string) {
  const [label] = await executor
    .select()
    .from(labelTable)
    .where(eq(labelTable.id, id))
    .for("update");
  return label;
}

export async function deleteLabelById(executor: Executor, id: string) {
  const [deletedLabel] = await executor
    .delete(labelTable)
    .where(eq(labelTable.id, id))
    .returning();
  return deletedLabel;
}

/** Same-name task-level copies of a workspace label, with their task and project ids. */
export async function listTaskLabelCopiesWithTask(
  executor: Executor,
  workspaceId: string,
  name: string,
) {
  return executor
    .select({
      label: labelTable,
      taskId: taskTable.id,
      projectId: taskTable.projectId,
    })
    .from(labelTable)
    .innerJoin(taskTable, eq(labelTable.taskId, taskTable.id))
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        eq(labelTable.name, name),
        isNotNull(labelTable.taskId),
      ),
    );
}

/** Task ids of the same-name task-level copies of a workspace label. */
export async function listTaskLabelCopyTaskIds(
  executor: Executor,
  workspaceId: string,
  name: string,
) {
  return executor
    .select({ taskId: labelTable.taskId })
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        eq(labelTable.name, name),
        isNotNull(labelTable.taskId),
      ),
    );
}

/** Row-lock (task id, label id order) the same-name copies that sit on the given tasks. */
export async function lockTaskLabelCopies(
  executor: Executor,
  workspaceId: string,
  name: string,
  taskIds: string[],
) {
  return executor
    .select({ id: labelTable.id })
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        eq(labelTable.name, name),
        isNotNull(labelTable.taskId),
        inArray(labelTable.taskId, taskIds),
      ),
    )
    .orderBy(asc(labelTable.taskId), asc(labelTable.id))
    .for("update");
}

export async function deleteLabelsByIds(executor: Executor, ids: string[]) {
  return executor
    .delete(labelTable)
    .where(inArray(labelTable.id, ids))
    .returning();
}

export async function updateLabelById(
  executor: Executor,
  id: string,
  values: { name: string; color: string },
) {
  const [updatedLabel] = await executor
    .update(labelTable)
    .set(values)
    .where(eq(labelTable.id, id))
    .returning();
  return updatedLabel;
}

export async function updateLabelsByIds(
  executor: Executor,
  ids: string[],
  values: { name: string; color: string },
) {
  await executor
    .update(labelTable)
    .set(values)
    .where(inArray(labelTable.id, ids));
}
