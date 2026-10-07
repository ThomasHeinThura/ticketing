import { and, eq, inArray, isNull, max, or } from "drizzle-orm";
import db from "../database";
import {
  personTable,
  roleTable,
  stateTable,
  stateTemplateTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  workItemTable,
  workItemTypeTable,
} from "../database/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export function listWorkflowsQuery(workspaceId: string) {
  return db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.workspaceId, workspaceId));
}

export function getWorkflowQuery(id: string) {
  return db.query.workflowTable.findFirst({
    where: eq(workflowTable.id, id),
    with: { versions: { with: { transitions: true } } },
  });
}
export type WorkflowWithVersions = NonNullable<
  Awaited<ReturnType<typeof getWorkflowQuery>>
>;
export const getWorkflowWorkspaceQuery = (workflowId: string) =>
  db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1);
export const listWorkflowTemplatesQuery = (workspaceId: string) =>
  db
    .select({ id: stateTemplateTable.id, group: stateTemplateTable.group })
    .from(stateTemplateTable)
    .where(eq(stateTemplateTable.workspaceId, workspaceId));
export const listWorkflowRolesQuery = (workspaceId: string) =>
  db
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(
      or(eq(roleTable.workspaceId, workspaceId), isNull(roleTable.workspaceId)),
    );
export const listWorkflowPeopleQuery = (ids: string[]) =>
  db
    .select({ id: personTable.id })
    .from(personTable)
    .where(inArray(personTable.id, ids));
export const getNextWorkflowVersionNumberQuery = (
  executor: Executor,
  workflowId: string,
) =>
  executor
    .select({ nextNumber: max(workflowVersionTable.number) })
    .from(workflowVersionTable)
    .where(eq(workflowVersionTable.workflowId, workflowId));
export const getWorkflowVersionIdQuery = (workflowId: string, number: number) =>
  db
    .select({ id: workflowVersionTable.id })
    .from(workflowVersionTable)
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
      ),
    )
    .limit(1);
export const getWorkflowVersionQuery = (workflowId: string, number: number) =>
  db
    .select()
    .from(workflowVersionTable)
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
      ),
    )
    .limit(1);
export const listWorkflowTransitionsQuery = (
  executor: Executor,
  versionId: string,
) =>
  executor
    .select()
    .from(workflowTransitionTable)
    .where(eq(workflowTransitionTable.versionId, versionId));
export const getWorkflowPublisherQuery = (userId: string) =>
  db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
export const listWorkflowTypeIdsQuery = (workflowId: string) =>
  db
    .select({ id: workItemTypeTable.id })
    .from(workItemTypeTable)
    .where(eq(workItemTypeTable.workflowId, workflowId));
export const listAdoptingProjectsQuery = (typeIds: string[]) =>
  db
    .selectDistinct({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(inArray(workItemTable.typeId, typeIds));
export const listProjectDefaultStatesQuery = (projectIds: string[]) =>
  db
    .select({
      projectId: stateTable.projectId,
      stateTemplateId: stateTable.stateTemplateId,
    })
    .from(stateTable)
    .where(
      and(
        inArray(stateTable.projectId, projectIds),
        eq(stateTable.isDefault, true),
      ),
    );
export const listProjectEnabledStatesQuery = (projectId: string) =>
  db
    .select({
      stateTemplateId: stateTable.stateTemplateId,
      isDefault: stateTable.isDefault,
    })
    .from(stateTable)
    .where(
      and(eq(stateTable.projectId, projectId), isNull(stateTable.archivedAt)),
    );
export const listStuckWorkItemKeysQuery = (projectId: string) =>
  db
    .select({
      key: workItemTable.key,
      stateTemplateId: stateTable.stateTemplateId,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .where(
      and(
        eq(workItemTable.projectId, projectId),
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
      ),
    );
