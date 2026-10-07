import { and, eq } from "drizzle-orm";
import db from "../database";
import { columnTable, workflowRuleTable } from "../database/schema";

export const findRuleColumnQuery = (columnId: string, projectId: string) =>
  db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.id, columnId),
      eq(columnTable.projectId, projectId),
    ),
  });
export const findWorkflowRuleQuery = (
  projectId: string,
  integrationType: string,
  eventType: string,
) =>
  db.query.workflowRuleTable.findFirst({
    where: and(
      eq(workflowRuleTable.projectId, projectId),
      eq(workflowRuleTable.integrationType, integrationType),
      eq(workflowRuleTable.eventType, eventType),
    ),
  });
export const getWorkflowRuleQuery = (id: string) =>
  db.query.workflowRuleTable.findFirst({ where: eq(workflowRuleTable.id, id) });
export function listWorkflowRulesQuery(projectId: string) {
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
