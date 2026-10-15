import type { JsonValue } from "@taskdesk/domain";
import { and, eq, inArray, isNull, max, or } from "drizzle-orm";
import db from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
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

/**
 * Query ownership for workflows (issue #580). Statements that run inside the controllers'
 * transactions take the handle as their first parameter (`Executor`); the others use the
 * shared connection. Every function awaits and returns rows. Moved verbatim from the
 * workflow controllers: the workspace/role/person ownership checks they feed stay in the
 * controllers.
 */

export type NewWorkflowTransition = Omit<
  typeof workflowTransitionTable.$inferInsert,
  "id" | "createdAt"
>;

function queryWorkflowTree(id: string) {
  return db.query.workflowTable.findFirst({
    where: eq(workflowTable.id, id),
    with: {
      versions: {
        with: { transitions: true },
      },
    },
  });
}

type DatabaseWorkflowTree = NonNullable<
  Awaited<ReturnType<typeof queryWorkflowTree>>
>;
type DatabaseWorkflowVersion = DatabaseWorkflowTree["versions"][number];
type DatabaseWorkflowTransition =
  DatabaseWorkflowVersion["transitions"][number];
type MaterializedWorkflowTransition = Omit<
  DatabaseWorkflowTransition,
  "guards" | "effects"
> & {
  guards: JsonValue;
  effects: JsonValue;
};
type MaterializedWorkflowVersion = Omit<
  DatabaseWorkflowVersion,
  "transitions"
> & {
  transitions: MaterializedWorkflowTransition[];
};
type MaterializedWorkflowTree = Omit<DatabaseWorkflowTree, "versions"> & {
  versions: MaterializedWorkflowVersion[];
};

/**
 * The non-null workflow-transition JSONB columns are decoded by the app's standard
 * node-postgres JSONB parser (`JSON.parse`) and Drizzle passes decoded values through.
 * Narrow only these persisted JSON leaves to the existing JsonValue contract; do not
 * claim that persisted values satisfy the workflow guard/effect domain unions.
 */
function materializeWorkflowTree(
  tree: DatabaseWorkflowTree,
): MaterializedWorkflowTree {
  return {
    ...tree,
    versions: tree.versions.map((version) => ({
      ...version,
      transitions: version.transitions.map(materializeWorkflowTransition),
    })),
  };
}

function materializeWorkflowTransition(
  transition: DatabaseWorkflowTransition,
): MaterializedWorkflowTransition {
  return {
    ...transition,
    guards: transition.guards as JsonValue,
    effects: transition.effects as JsonValue,
  };
}

export async function insertWorkflow(values: {
  workspaceId: string;
  key: string;
  name: string;
}) {
  const [inserted] = await db.insert(workflowTable).values(values).returning();
  return inserted;
}

/** One workflow with its versions and each version's transitions. */
export async function findWorkflowTree(
  id: string,
): Promise<MaterializedWorkflowTree | undefined> {
  const workflow = await queryWorkflowTree(id);
  return workflow ? materializeWorkflowTree(workflow) : undefined;
}

export async function listWorkflowsInWorkspace(workspaceId: string) {
  return db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.workspaceId, workspaceId));
}

export async function findWorkflowWorkspaceId(workflowId: string) {
  const [workflow] = await db
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1);
  return workflow;
}

export async function findWorkflowVersion(workflowId: string, number: number) {
  const [version] = await db
    .select()
    .from(workflowVersionTable)
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
      ),
    )
    .limit(1);
  return version;
}

export async function findWorkflowVersionId(
  workflowId: string,
  number: number,
) {
  const [version] = await db
    .select({ id: workflowVersionTable.id })
    .from(workflowVersionTable)
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
      ),
    )
    .limit(1);
  return version;
}

export async function findPersonIdByUserId(userId: string) {
  const [caller] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);
  return caller;
}

export async function stampVersionPublished(
  executor: Executor,
  versionId: string,
  publishedBy: string | null,
) {
  const [published] = await executor
    .update(workflowVersionTable)
    .set({ publishedAt: new Date(), publishedBy })
    .where(eq(workflowVersionTable.id, versionId))
    .returning();
  return published;
}

export async function setActiveWorkflowVersion(
  executor: Executor,
  workflowId: string,
  versionId: string,
): Promise<void> {
  await executor
    .update(workflowTable)
    .set({ activeVersionId: versionId })
    .where(eq(workflowTable.id, workflowId));
}

export async function listVersionTransitions(
  versionId: string,
  executor?: Executor,
) {
  const transitions = await executorOrDefault(executor)
    .select()
    .from(workflowTransitionTable)
    .where(eq(workflowTransitionTable.versionId, versionId));
  return transitions.map(materializeWorkflowTransition);
}

export async function listStateTemplates(workspaceId: string) {
  return db
    .select({ id: stateTemplateTable.id, group: stateTemplateTable.group })
    .from(stateTemplateTable)
    .where(eq(stateTemplateTable.workspaceId, workspaceId));
}

/** Role ids this workspace may reference: its own and the built-in (workspace-less) ones. */
export async function listReferenceableRoleIds(workspaceId: string) {
  return db
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(
      or(eq(roleTable.workspaceId, workspaceId), isNull(roleTable.workspaceId)),
    );
}

export async function listExistingPersonIds(personIds: string[]) {
  return db
    .select({ id: personTable.id })
    .from(personTable)
    .where(inArray(personTable.id, personIds));
}

export async function getMaxVersionNumber(
  executor: Executor,
  workflowId: string,
) {
  const [maxRow] = await executor
    .select({ nextNumber: max(workflowVersionTable.number) })
    .from(workflowVersionTable)
    .where(eq(workflowVersionTable.workflowId, workflowId));
  return maxRow;
}

export async function insertWorkflowVersion(
  executor: Executor,
  values: { workflowId: string; number: number },
) {
  const [version] = await executor
    .insert(workflowVersionTable)
    .values(values)
    .returning();
  return version;
}

export async function insertWorkflowTransitions(
  executor: Executor,
  rows: NewWorkflowTransition[],
) {
  const inserted = await executor
    .insert(workflowTransitionTable)
    .values(rows)
    .returning();
  return inserted.map(materializeWorkflowTransition);
}

export async function listWorkflowTypeIds(workflowId: string) {
  return db
    .select({ id: workItemTypeTable.id })
    .from(workItemTypeTable)
    .where(eq(workItemTypeTable.workflowId, workflowId));
}

export async function listProjectIdsWithItemsOfTypes(typeIds: string[]) {
  return db
    .selectDistinct({ projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(inArray(workItemTable.typeId, typeIds));
}

export async function listDefaultStateTemplates(projectIds: string[]) {
  return db
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
}

export async function listEnabledProjectStates(projectId: string) {
  return db
    .select({
      stateTemplateId: stateTable.stateTemplateId,
      isDefault: stateTable.isDefault,
    })
    .from(stateTable)
    .where(
      and(eq(stateTable.projectId, projectId), isNull(stateTable.archivedAt)),
    );
}

/** Live work items of a project with the template of their current state. */
export async function listLiveItemsWithStateTemplate(projectId: string) {
  return db
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
}
