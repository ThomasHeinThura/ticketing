import type { JsonValue } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  max,
  not,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import db from "../database";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  currentProjectReachPredicate,
  currentWorkspaceReachPredicate,
} from "../database/identity-scope-predicates";
import {
  projectTable,
  roleTable,
  stateTable,
  stateTemplateTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";

/**
 * Query ownership for workflows (issue #580). Statements that run inside the controllers'
 * transactions take the handle as their first parameter (`Executor`); the others use the
 * shared connection. Every actor-facing read takes resolved identity and applies reach
 * in SQL. Writes and transaction order remain unchanged.
 */

export type NewWorkflowTransition = Omit<
  typeof workflowTransitionTable.$inferInsert,
  "id" | "createdAt"
>;

/** Workspace-scoped workflow reads follow the authenticated user's persisted workspace
 * membership; an instance administrator has the existing global reach. IDs are always
 * additional narrowing terms. */
function workflowWorkspaceReach(
  identity: ResolvedIdentity,
  workspaceId: string | SQLWrapper,
  executor: Executor = db,
) {
  if (identity.side !== "staff") return sql`false`;
  return and(
    eq(workspaceTable.id, workspaceId),
    currentWorkspaceReachPredicate(identity, workspaceTable.id, executor),
  );
}

function projectReach(
  identity: ResolvedIdentity,
  projectId: string | SQLWrapper,
  executor: Executor = db,
) {
  const projectFilter = eq(projectTable.id, projectId);
  if (identity.side !== "staff") return sql`false`;
  return and(
    projectFilter,
    currentProjectReachPredicate(
      identity,
      projectTable.id,
      projectTable.workspaceId,
      sql`NULL`,
      executor,
    ),
  );
}

function queryWorkflowTree(identity: ResolvedIdentity, id: string) {
  const visibleWorkflowIds = db
    .select({ id: workflowTable.id })
    .from(workflowTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(workflowWorkspaceReach(identity, workspaceTable.id));
  return db.query.workflowTable.findFirst({
    where: and(
      eq(workflowTable.id, id),
      inArray(workflowTable.id, visibleWorkflowIds),
    ),
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
  identity: ResolvedIdentity,
  id: string,
): Promise<MaterializedWorkflowTree | undefined> {
  const workflow = await queryWorkflowTree(identity, id);
  return workflow ? materializeWorkflowTree(workflow) : undefined;
}

export async function listWorkflowsInWorkspace(
  identity: ResolvedIdentity,
  workspaceId: string,
) {
  return db
    .select({ workflow: workflowTable })
    .from(workflowTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(workflowWorkspaceReach(identity, workspaceId))
    .then((rows) => rows.map((row) => row.workflow));
}

export async function findWorkflowWorkspaceId(
  identity: ResolvedIdentity,
  workflowId: string,
  executor?: Executor,
) {
  const [workflow] = await executorOrDefault(executor)
    .select({ workspaceId: workflowTable.workspaceId })
    .from(workflowTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(
      and(
        eq(workflowTable.id, workflowId),
        workflowWorkspaceReach(
          identity,
          workflowTable.workspaceId,
          executor ?? db,
        ),
      ),
    )
    .limit(1);
  return workflow;
}

export async function findWorkflowVersion(
  identity: ResolvedIdentity,
  workflowId: string,
  number: number,
  executor?: Executor,
) {
  const [version] = await executorOrDefault(executor)
    .select({ version: workflowVersionTable })
    .from(workflowVersionTable)
    .innerJoin(
      workflowTable,
      eq(workflowTable.id, workflowVersionTable.workflowId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
        workflowWorkspaceReach(
          identity,
          workflowTable.workspaceId,
          executor ?? db,
        ),
      ),
    )
    .limit(1);
  return version?.version;
}

export async function findWorkflowVersionId(
  identity: ResolvedIdentity,
  workflowId: string,
  number: number,
  executor?: Executor,
) {
  const [version] = await executorOrDefault(executor)
    .select({ id: workflowVersionTable.id })
    .from(workflowVersionTable)
    .innerJoin(
      workflowTable,
      eq(workflowTable.id, workflowVersionTable.workflowId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
        workflowWorkspaceReach(
          identity,
          workflowTable.workspaceId,
          executor ?? db,
        ),
      ),
    )
    .limit(1);
  return version;
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
  identity: ResolvedIdentity,
  versionId: string,
  executor?: Executor,
) {
  const rows = await executorOrDefault(executor)
    .select({ transition: workflowTransitionTable })
    .from(workflowTransitionTable)
    .innerJoin(
      workflowVersionTable,
      eq(workflowVersionTable.id, workflowTransitionTable.versionId),
    )
    .innerJoin(
      workflowTable,
      eq(workflowTable.id, workflowVersionTable.workflowId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(
      and(
        eq(workflowTransitionTable.versionId, versionId),
        workflowWorkspaceReach(
          identity,
          workflowTable.workspaceId,
          executor ?? db,
        ),
      ),
    );
  return rows.map((row) => materializeWorkflowTransition(row.transition));
}

export async function listStateTemplates(
  identity: ResolvedIdentity,
  workspaceId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({ id: stateTemplateTable.id, group: stateTemplateTable.group })
    .from(stateTemplateTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, stateTemplateTable.workspaceId),
    )
    .where(
      and(
        eq(stateTemplateTable.workspaceId, workspaceId),
        workflowWorkspaceReach(identity, workspaceId, executor ?? db),
      ),
    );
}

/** Role ids this workspace may reference: its own and the built-in (workspace-less) ones. */
export async function listReferenceableRoleIds(
  identity: ResolvedIdentity,
  workspaceId: string,
  executor?: Executor,
) {
  const query = executorOrDefault(executor);
  return query
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(
      and(
        or(
          eq(roleTable.workspaceId, workspaceId),
          isNull(roleTable.workspaceId),
        ),
        exists(
          query
            .select({ one: sql`1` })
            .from(workspaceTable)
            .where(workflowWorkspaceReach(identity, workspaceId, query)),
        ),
      ),
    );
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

/** All project rows in the workflow's workspace are its WF-9 adopting-project set,
 * including projects without items and archived projects. */
export async function listWorkflowAdoptingProjectIds(
  identity: ResolvedIdentity,
  workflowId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({ projectId: projectTable.id })
    .from(projectTable)
    .innerJoin(
      workflowTable,
      eq(workflowTable.workspaceId, projectTable.workspaceId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(
      and(
        eq(workflowTable.id, workflowId),
        workflowWorkspaceReach(identity, workspaceTable.id, executor ?? db),
        projectReach(identity, projectTable.id, executor),
      ),
    );
}

/** A scalar refusal oracle: it exposes no hidden project IDs or counts. The existing
 * adopting-project set is every project row in the workflow's workspace, including empty
 * and archived projects; do not silently validate a reachable subset. */
export async function hasCompleteWorkflowProjectReach(
  identity: ResolvedIdentity,
  workflowId: string,
  executor?: Executor,
) {
  if (identity.side !== "staff") return false;
  const query = executorOrDefault(executor);
  const [visibleWorkflow] = await query
    .select({ id: workflowTable.id })
    .from(workflowTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .where(
      and(
        eq(workflowTable.id, workflowId),
        workflowWorkspaceReach(identity, workflowTable.workspaceId, query),
      ),
    )
    .limit(1);
  if (!visibleWorkflow) return false;

  const rows = await query
    .select({ projectId: projectTable.id })
    .from(workflowTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, workflowTable.workspaceId))
    .innerJoin(
      projectTable,
      eq(projectTable.workspaceId, workflowTable.workspaceId),
    )
    .where(
      and(
        eq(workflowTable.id, workflowId),
        workflowWorkspaceReach(identity, workspaceTable.id, query),
        not(projectReach(identity, projectTable.id, executor) ?? sql`false`),
      ),
    )
    .limit(1);
  return rows.length === 0;
}

export async function listDefaultStateTemplates(
  identity: ResolvedIdentity,
  projectIds: string[],
  executor?: Executor,
) {
  if (projectIds.length === 0) return [];
  return executorOrDefault(executor)
    .select({
      projectId: stateTable.projectId,
      stateTemplateId: stateTable.stateTemplateId,
    })
    .from(stateTable)
    .innerJoin(projectTable, eq(projectTable.id, stateTable.projectId))
    .where(
      and(
        inArray(stateTable.projectId, projectIds),
        eq(stateTable.isDefault, true),
        projectReach(identity, projectTable.id, executor) ?? sql`false`,
      ),
    );
}

export async function listEnabledProjectStates(
  identity: ResolvedIdentity,
  projectId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({
      stateTemplateId: stateTable.stateTemplateId,
      isDefault: stateTable.isDefault,
    })
    .from(stateTable)
    .innerJoin(projectTable, eq(projectTable.id, stateTable.projectId))
    .where(
      and(
        eq(stateTable.projectId, projectId),
        projectReach(identity, projectTable.id, executor) ?? sql`false`,
        isNull(stateTable.archivedAt),
      ),
    );
}

/** Live work items of a project with the template of their current state. */
export async function listLiveItemsWithStateTemplate(
  identity: ResolvedIdentity,
  projectId: string,
  executor?: Executor,
) {
  return executorOrDefault(executor)
    .select({
      key: workItemTable.key,
      stateTemplateId: stateTable.stateTemplateId,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        eq(workItemTable.projectId, projectId),
        projectReach(identity, projectTable.id, executor) ?? sql`false`,
        isNull(workItemTable.archivedAt),
        isNull(workItemTable.deletedAt),
      ),
    );
}
