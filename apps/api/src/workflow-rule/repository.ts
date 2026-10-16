import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, exists, sql } from "drizzle-orm";
import db from "../database";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { columnTable, projectTable, workflowRuleTable } from "../database/schema";

export type NewWorkflowRule = Pick<
  typeof workflowRuleTable.$inferInsert,
  "projectId" | "integrationType" | "eventType" | "columnId"
>;

function reachableProject(identity: ResolvedIdentity, projectId: string) {
  return exists(
    db
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
            db,
          ),
        ),
      ),
  );
}

function reachableRule(identity: ResolvedIdentity) {
  return exists(
    db
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
            db,
          ),
        ),
      ),
  );
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
  const [deleted] = await db
    .delete(workflowRuleTable)
    .where(and(eq(workflowRuleTable.id, id), reachableRule(identity)))
    .returning();
  return deleted;
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
  const [updated] = await db
    .update(workflowRuleTable)
    .set({ columnId })
    .where(
      and(
        eq(workflowRuleTable.id, id),
        eq(workflowRuleTable.projectId, projectId),
        reachableProject(identity, projectId),
        exists(
          db
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
}

export async function insertWorkflowRule(
  identity: ResolvedIdentity,
  values: NewWorkflowRule,
) {
  const [created] = await db
    .insert(workflowRuleTable)
    .select(
      db
        .select({
          projectId: projectTable.id,
          integrationType: sql`${values.integrationType}`.as("integration_type"),
          eventType: sql`${values.eventType}`.as("event_type"),
          columnId: columnTable.id,
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
              db,
            ),
          ),
        )
        .limit(1),
    )
    .returning();
  return created;
}
