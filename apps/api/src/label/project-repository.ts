import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { labelTable, projectTable } from "../database/schema";

function projectScope(
  identity: ResolvedIdentity,
  projectId: string,
  executor: Executor,
) {
  return and(
    eq(projectTable.id, projectId),
    isNull(projectTable.deletedAt),
    isNull(projectTable.archivedAt),
    currentProjectReachPredicate(
      identity,
      projectTable.id,
      projectTable.workspaceId,
      projectTable.organisationId,
      executor,
    ),
  );
}

export async function findLabelProject(
  identity: ResolvedIdentity,
  projectId: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  const [project] = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(projectScope(identity, projectId, db));
  return project;
}

function projectLabels(
  identity: ResolvedIdentity,
  projectId: string,
  executor: Executor,
) {
  return executor
    .select({ label: labelTable })
    .from(labelTable)
    .innerJoin(
      projectTable,
      and(
        eq(labelTable.projectId, projectTable.id),
        eq(labelTable.workspaceId, projectTable.workspaceId),
      ),
    )
    .where(projectScope(identity, projectId, executor))
    .orderBy(labelTable.name, labelTable.id);
}

export async function listProjectLabels(
  identity: ResolvedIdentity,
  projectId: string,
  executor?: Executor,
) {
  const db = executorOrDefault(executor);
  return (await projectLabels(identity, projectId, db)).map(
    ({ label }) => label,
  );
}

export async function lockProjectLabel(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  executor: Executor,
) {
  const [row] = await executor
    .select({ label: labelTable })
    .from(labelTable)
    .innerJoin(
      projectTable,
      and(
        eq(labelTable.projectId, projectTable.id),
        eq(labelTable.workspaceId, projectTable.workspaceId),
      ),
    )
    .where(
      and(projectScope(identity, projectId, executor), eq(labelTable.id, id)),
    )
    .for("update", { of: labelTable });
  return row?.label;
}

export async function insertProjectLabel(
  identity: ResolvedIdentity,
  projectId: string,
  name: string,
  color: string,
  executor: Executor,
) {
  const [inserted] = await executor
    .insert(labelTable)
    .select(
      executor
        .select({
          id: sql`${createId()}`.as("id"),
          key: sql`null`.as("key"),
          name: sql`${name}`.as("name"),
          color: sql`${color}`.as("color"),
          createdAt: sql`now()`.as("created_at"),
          updatedAt: sql`now()`.as("updated_at"),
          taskId: sql`null`.as("task_id"),
          workspaceId: projectTable.workspaceId,
          projectId: projectTable.id,
        })
        .from(projectTable)
        .where(projectScope(identity, projectId, executor)),
    )
    .onConflictDoNothing({
      target: [labelTable.projectId, labelTable.name],
      where: sql`${labelTable.projectId} IS NOT NULL`,
    })
    .returning();
  if (inserted) return inserted;
  return (await listProjectLabels(identity, projectId, executor)).find(
    (label) => label.name === name,
  );
}

function reachableProject(
  identity: ResolvedIdentity,
  projectId: string,
  executor: Executor,
) {
  return executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(projectScope(identity, projectId, executor));
}

export async function updateProjectLabel(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  values: { name: string; color: string },
  executor: Executor,
) {
  const [label] = await executor
    .update(labelTable)
    .set(values)
    .where(
      and(
        eq(labelTable.id, id),
        eq(labelTable.projectId, projectId),
        sql`EXISTS (${reachableProject(identity, projectId, executor)})`,
      ),
    )
    .returning();
  return label;
}

export async function deleteProjectLabel(
  identity: ResolvedIdentity,
  projectId: string,
  id: string,
  executor: Executor,
) {
  const [label] = await executor
    .delete(labelTable)
    .where(
      and(
        eq(labelTable.id, id),
        eq(labelTable.projectId, projectId),
        sql`EXISTS (${reachableProject(identity, projectId, executor)})`,
      ),
    )
    .returning();
  return label;
}
