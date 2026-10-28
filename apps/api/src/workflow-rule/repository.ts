import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, asc, eq, exists, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  columnTable,
  projectTable,
  workflowRuleTable,
} from "../database/schema";

export type NewWorkflowRule = Pick<
  typeof workflowRuleTable.$inferInsert,
  "projectId" | "integrationType" | "eventType" | "columnId"
>;

function reachableProject(
  identity: ResolvedIdentity,
  projectId: string,
  executor: Executor = db,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          sql`${projectTable.deletedAt} IS NULL`,
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

function reachableRule(identity: ResolvedIdentity, executor: Executor = db) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, workflowRuleTable.projectId),
          sql`${projectTable.deletedAt} IS NULL`,
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

/** A rule write shares the project row with deletion's exclusive project-scope fence. */
async function lockProjectForRuleWrite(
  tx: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [project] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        sql`${projectTable.deletedAt} IS NULL`,
        reachableProject(identity, projectId, tx),
      ),
    )
    .orderBy(asc(projectTable.id))
    .for("share")
    .limit(1);
  return project;
}

export async function findWorkflowRuleById(
  identity: ResolvedIdentity,
  id: string,
) {
  const [row] = await db
    .select()
    .from(workflowRuleTable)
    .where(and(eq(workflowRuleTable.id, id), reachableRule(identity)))
    .limit(1);
  return row;
}

export async function deleteWorkflowRuleById(
  identity: ResolvedIdentity,
  id: string,
) {
  return db.transaction(async (tx) => {
    const [anchor] = await tx
      .select({ projectId: workflowRuleTable.projectId })
      .from(workflowRuleTable)
      .where(and(eq(workflowRuleTable.id, id), reachableRule(identity, tx)))
      .limit(1);
    if (!anchor) return undefined;
    if (!(await lockProjectForRuleWrite(tx, identity, anchor.projectId)))
      return undefined;
    const [deleted] = await tx
      .delete(workflowRuleTable)
      .where(and(eq(workflowRuleTable.id, id), reachableRule(identity, tx)))
      .returning();
    return deleted;
  });
}

export async function listWorkflowRulesWithColumn(
  identity: ResolvedIdentity,
  projectId: string,
) {
  return await db
    .select({
      id: workflowRuleTable.id,
      projectId: workflowRuleTable.projectId,
      integrationType: workflowRuleTable.integrationType,
      eventType: workflowRuleTable.eventType,
      columnId: workflowRuleTable.columnId,
      columnName: columnTable.name,
      columnSlug: columnTable.slug,
      createdAt: workflowRuleTable.createdAt,
      updatedAt: workflowRuleTable.updatedAt,
    })
    .from(workflowRuleTable)
    .leftJoin(columnTable, eq(workflowRuleTable.columnId, columnTable.id))
    .where(
      and(
        eq(workflowRuleTable.projectId, projectId),
        reachableProject(identity, projectId),
      ),
    );
}

export async function findColumnInProject(
  identity: ResolvedIdentity,
  projectId: string,
  columnId: string,
) {
  const [row] = await db
    .select()
    .from(columnTable)
    .where(
      and(
        eq(columnTable.id, columnId),
        eq(columnTable.projectId, projectId),
        reachableProject(identity, projectId),
      ),
    )
    .limit(1);
  return row;
}

export async function findWorkflowRuleForEvent(
  identity: ResolvedIdentity,
  projectId: string,
  integrationType: string,
  eventType: string,
) {
  const [row] = await db
    .select()
    .from(workflowRuleTable)
    .where(
      and(
        eq(workflowRuleTable.projectId, projectId),
        eq(workflowRuleTable.integrationType, integrationType),
        eq(workflowRuleTable.eventType, eventType),
        reachableProject(identity, projectId),
      ),
    )
    .limit(1);
  return row;
}

export async function updateWorkflowRuleColumn(
  identity: ResolvedIdentity,
  id: string,
  projectId: string,
  columnId: string,
) {
  return db.transaction(async (tx) => {
    if (!(await lockProjectForRuleWrite(tx, identity, projectId)))
      return undefined;
    const [updated] = await tx
      .update(workflowRuleTable)
      .set({ columnId })
      .where(
        and(
          eq(workflowRuleTable.id, id),
          eq(workflowRuleTable.projectId, projectId),
          reachableProject(identity, projectId, tx),
          exists(
            tx
              .select({ one: sql`1` })
              .from(columnTable)
              .where(
                and(
                  eq(columnTable.id, columnId),
                  eq(columnTable.projectId, projectId),
                ),
              ),
          ),
        ),
      )
      .returning();
    return updated;
  });
}

export async function insertWorkflowRule(
  identity: ResolvedIdentity,
  values: NewWorkflowRule,
) {
  return db.transaction(async (tx) => {
    if (!(await lockProjectForRuleWrite(tx, identity, values.projectId)))
      return undefined;
    const [created] = await tx
      .insert(workflowRuleTable)
      .select(
        tx
          .select({
            id: sql`${createId()}`.as("id"),
            projectId: projectTable.id,
            integrationType:
              sql`${sql.param(values.integrationType, workflowRuleTable.integrationType)}`.as(
                "integration_type",
              ),
            eventType:
              sql`${sql.param(values.eventType, workflowRuleTable.eventType)}`.as(
                "event_type",
              ),
            columnId: columnTable.id,
            createdAt: sql`now()`.as("created_at"),
            updatedAt: sql`now()`.as("updated_at"),
          })
          .from(projectTable)
          .innerJoin(
            columnTable,
            and(
              eq(columnTable.projectId, projectTable.id),
              eq(columnTable.id, values.columnId),
            ),
          )
          .where(
            and(
              eq(projectTable.id, values.projectId),
              sql`${projectTable.deletedAt} IS NULL`,
              currentProjectReachPredicate(
                identity,
                projectTable.id,
                projectTable.workspaceId,
                projectTable.organisationId,
                tx,
              ),
            ),
          )
          .limit(1),
      )
      .returning();
    return created;
  });
}
