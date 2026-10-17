import { and, eq } from "drizzle-orm";
import db from "../database";
import { columnTable, workflowRuleTable } from "../database/schema";

/**
 * Query ownership for `workflow_rule` (issue #580). Every function awaits and returns
 * rows; none opens a transaction, as the controllers did not.
 */

export type NewWorkflowRule = Pick<
  typeof workflowRuleTable.$inferInsert,
  "projectId" | "integrationType" | "eventType" | "columnId"
>;

export async function findWorkflowRuleById(id: string) {
  return db.query.workflowRuleTable.findFirst({
    where: eq(workflowRuleTable.id, id),
  });
}

export async function deleteWorkflowRuleById(id: string): Promise<void> {
  await db.delete(workflowRuleTable).where(eq(workflowRuleTable.id, id));
}

export async function listWorkflowRulesWithColumn(projectId: string) {
  return db
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
    .where(eq(workflowRuleTable.projectId, projectId));
}

/** The column when it belongs to the project, else `undefined`. */
export async function findColumnInProject(projectId: string, columnId: string) {
  return db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.id, columnId),
      eq(columnTable.projectId, projectId),
    ),
  });
}

export async function findWorkflowRuleForEvent(
  projectId: string,
  integrationType: string,
  eventType: string,
) {
  return db.query.workflowRuleTable.findFirst({
    where: and(
      eq(workflowRuleTable.projectId, projectId),
      eq(workflowRuleTable.integrationType, integrationType),
      eq(workflowRuleTable.eventType, eventType),
    ),
  });
}

export async function updateWorkflowRuleColumn(id: string, columnId: string) {
  const [updated] = await db
    .update(workflowRuleTable)
    .set({ columnId })
    .where(eq(workflowRuleTable.id, id))
    .returning();
  return updated;
}

export async function insertWorkflowRule(values: NewWorkflowRule) {
  const [created] = await db
    .insert(workflowRuleTable)
    .values(values)
    .returning();
  return created;
}
