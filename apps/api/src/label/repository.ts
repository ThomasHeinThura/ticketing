import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  labelTable,
  type labelTable as labelTableType,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";

/**
 * Label repository (issue #580). Every label statement lives here; the controllers keep the
 * transaction boundaries, lock order, publishEvent calls and error mapping. Every actor-facing
 * content read and returned write carries current workspace/project reach in SQL.
 */

export type LabelRow = typeof labelTableType.$inferSelect;

function currentLabelReach(identity: ResolvedIdentity, executor: Executor) {
  const taskProjectReach = exists(
    executor
      .select({ one: sql`1` })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, labelTable.taskId),
          eq(projectTable.workspaceId, labelTable.workspaceId),
          isNull(projectTable.deletedAt),
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
  return or(
    and(
      isNull(labelTable.taskId),
      currentWorkspaceReachPredicate(
        identity,
        labelTable.workspaceId,
        executor,
      ),
    ),
    and(isNotNull(labelTable.taskId), taskProjectReach),
  );
}

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

/** Minimal task/workspace bootstrap facts, visible only through current project reach. */
export async function findTaskWithWorkspace(
  identity: ResolvedIdentity,
  taskId: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
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
          db,
        ),
      ),
    )
    .limit(1);
  return task;
}

/** A task by id, only when its project belongs to `workspaceId` (tenant predicate in SQL). */
export async function findTaskInWorkspace(
  identity: ResolvedIdentity,
  taskId: string,
  workspaceId: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        eq(projectTable.workspaceId, workspaceId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          db,
        ),
      ),
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
  return await executor
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
}

export async function insertTaskLabelOnConflictDoNothing(
  executor: Executor,
  identity: ResolvedIdentity,
  values: {
    name: string;
    color: string;
    taskId: string;
    workspaceId: string;
  },
) {
  const [inserted] = await executor
    .insert(labelTable)
    .select(
      executor
        .select({
          id: sql`${createId()}`.as("id"),
          name: sql`${values.name}`.as("name"),
          color: sql`${values.color}`.as("color"),
          createdAt: sql`now()`.as("created_at"),
          updatedAt: sql`now()`.as("updated_at"),
          taskId: sql`${values.taskId}`.as("task_id"),
          workspaceId: sql`${values.workspaceId}`.as("workspace_id"),
        })
        .from(taskTable)
        .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
        .where(
          and(
            eq(taskTable.id, values.taskId),
            eq(projectTable.workspaceId, values.workspaceId),
            currentProjectReachPredicate(
              identity,
              projectTable.id,
              projectTable.workspaceId,
              projectTable.organisationId,
              executor,
            ),
          ),
        )
        .limit(1),
    )
    .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] })
    .returning({ id: labelTable.id });
  return inserted
    ? await findTaskLabelByName(executor, identity, values.taskId, values.name)
    : undefined;
}

export async function findTaskLabelByName(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
  name: string,
) {
  const [label] = await executor
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.taskId, taskId),
        eq(labelTable.name, name),
        currentLabelReach(identity, executor),
      ),
    )
    .limit(1);
  return label;
}

export async function insertWorkspaceLabelOnConflictDoNothing(
  executor: Executor,
  identity: ResolvedIdentity,
  values: { name: string; color: string; workspaceId: string },
) {
  const [inserted] = await executor
    .insert(labelTable)
    .select(
      executor
        .select({
          id: sql`${createId()}`.as("id"),
          name: sql`${values.name}`.as("name"),
          color: sql`${values.color}`.as("color"),
          createdAt: sql`now()`.as("created_at"),
          updatedAt: sql`now()`.as("updated_at"),
          taskId: sql`null`.as("task_id"),
          workspaceId: sql`${values.workspaceId}`.as("workspace_id"),
        })
        .from(workspaceTable)
        .where(
          and(
            eq(workspaceTable.id, values.workspaceId),
            currentWorkspaceReachPredicate(
              identity,
              workspaceTable.id,
              executor,
            ),
          ),
        )
        .limit(1),
    )
    .onConflictDoNothing({
      target: [labelTable.workspaceId, labelTable.name],
      where: sql`${labelTable.taskId} is null`,
    })
    .returning({ id: labelTable.id });
  return inserted
    ? await findWorkspaceLabelByName(
        executor,
        identity,
        values.workspaceId,
        values.name,
      )
    : undefined;
}

export async function findWorkspaceLabelByName(
  executor: Executor,
  identity: ResolvedIdentity,
  workspaceId: string,
  name: string,
) {
  const [label] = await executor
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        eq(labelTable.name, name),
        isNull(labelTable.taskId),
        currentWorkspaceReachPredicate(
          identity,
          labelTable.workspaceId,
          executor,
        ),
      ),
    )
    .limit(1);
  return label;
}

export async function findLabelById(
  identity: ResolvedIdentity,
  id: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  const [label] = await db
    .select()
    .from(labelTable)
    .where(and(eq(labelTable.id, id), currentLabelReach(identity, db)))
    .limit(1);
  return label;
}

export async function findLabelsByTaskId(
  identity: ResolvedIdentity,
  taskId: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  return await db
    .select()
    .from(labelTable)
    .where(and(eq(labelTable.taskId, taskId), currentLabelReach(identity, db)));
}

/**
 * Workspace definitions are listed under current workspace reach. Task-bound labels are listed
 * only when the caller has current reach to their task's project; the predicate is in SQL.
 */
export async function listLabelsByWorkspaceId(
  identity: ResolvedIdentity,
  workspaceId: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  return await db
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        currentLabelReach(identity, db),
      ),
    );
}

/** Unlocked snapshot of the columns the family locks are derived from. */
export async function findLabelSnapshot(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
) {
  const [labelSnapshot] = await executor
    .select({
      taskId: labelTable.taskId,
      workspaceId: labelTable.workspaceId,
      name: labelTable.name,
    })
    .from(labelTable)
    .where(and(eq(labelTable.id, id), currentLabelReach(identity, executor)))
    .limit(1);
  return labelSnapshot;
}

export async function lockLabelRow(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
) {
  const [label] = await executor
    .select()
    .from(labelTable)
    .where(and(eq(labelTable.id, id), currentLabelReach(identity, executor)))
    .for("update");
  return label;
}

export async function deleteLabelById(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
) {
  const [deletedLabel] = await executor
    .delete(labelTable)
    .where(and(eq(labelTable.id, id), currentLabelReach(identity, executor)))
    .returning();
  return deletedLabel;
}

/** Minimal IDs for internal all-copy family propagation, including hidden projects. */
export async function listTaskLabelCopiesWithTask(
  executor: Executor,
  workspaceId: string,
  name: string,
) {
  return await executor
    .select({
      labelId: labelTable.id,
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
  return await executor
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
  return await executor
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
  return await executor
    .delete(labelTable)
    .where(inArray(labelTable.id, ids))
    .returning({ taskId: labelTable.taskId });
}

export async function updateLabelById(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
  values: { name: string; color: string },
) {
  const [updatedLabel] = await executor
    .update(labelTable)
    .set(values)
    .where(and(eq(labelTable.id, id), currentLabelReach(identity, executor)))
    .returning({ id: labelTable.id });
  return updatedLabel ? await findLabelById(identity, id, executor) : undefined;
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
