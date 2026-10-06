import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import db from "../database";
import { labelTable, projectTable, taskTable } from "../database/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export const getLabelQuery = (id: string) =>
  db.query.labelTable.findFirst({ where: (label, { eq }) => eq(label.id, id) });
export const getLabelSnapshotQuery = (id: string) =>
  db.query.labelTable.findFirst({ where: eq(labelTable.id, id) });
export const listLabelsByTaskQuery = (taskId: string) =>
  db.query.labelTable.findMany({
    where: (label, { eq }) => eq(label.taskId, taskId),
  });
export const listLabelsByWorkspaceQuery = (workspaceId: string) =>
  db.select().from(labelTable).where(eq(labelTable.workspaceId, workspaceId));
export function getLabelForUpdateQuery(executor: Executor, id: string) {
  return executor
    .select()
    .from(labelTable)
    .where(eq(labelTable.id, id))
    .for("update");
}
export function getLabelAssignmentSnapshotQuery(
  executor: Executor,
  id: string,
) {
  return executor
    .select({
      taskId: labelTable.taskId,
      workspaceId: labelTable.workspaceId,
      name: labelTable.name,
    })
    .from(labelTable)
    .where(eq(labelTable.id, id))
    .limit(1);
}
export function listCopiesByWorkspaceNameQuery(
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
export function listLockedCopiesQuery(
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
export function getTaskProjectQuery(executor: Executor, taskId: string) {
  return executor
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
}
export function getTaskProjectInWorkspaceQuery(
  taskId: string,
  workspaceId: string,
) {
  return db
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
}
export function getProjectWorkspaceQuery(
  executor: Executor,
  projectId: string,
) {
  return executor
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId));
}
export function getProjectsByIdsQuery(
  executor: Executor,
  projectIds: string[],
) {
  return executor
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
}
export function getAssignedLabelQuery(
  executor: Executor,
  taskId: string,
  name: string,
) {
  return executor.query.labelTable.findFirst({
    where: and(eq(labelTable.taskId, taskId), eq(labelTable.name, name)),
  });
}
export function getWorkspaceLabelQuery(
  executor: Executor,
  workspaceId: string,
  name: string,
) {
  return executor.query.labelTable.findFirst({
    where: and(
      eq(labelTable.workspaceId, workspaceId),
      eq(labelTable.name, name),
      isNotNull(labelTable.taskId),
    ),
  });
}
export function getWorkspaceBaseLabelQuery(
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
export function listAffectedLabelCopiesQuery(
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
