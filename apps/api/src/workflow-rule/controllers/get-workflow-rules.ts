import { eq } from "drizzle-orm";
import db from "../../database";
import { columnTable, workflowRuleTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function getWorkflowRules(projectId: string) {
  // #202: this route's subject IS a project (`workspaceAccess.fromProject`), so a
  // soft-deleted project's rules must be gone for ordinary use during its 30-day
  // recovery window (#187, PR-16). The controller never touched `projectTable`
  // itself, so nothing else in the chain applied the exclusion.
  await getProjectWorkspaceId(projectId);

  const rules = await db
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

  return rules;
}

export default getWorkflowRules;
