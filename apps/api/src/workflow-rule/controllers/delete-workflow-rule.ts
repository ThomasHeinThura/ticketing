import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workflowRuleTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function deleteWorkflowRule(id: string) {
  const existing = await db.query.workflowRuleTable.findFirst({
    where: eq(workflowRuleTable.id, id),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Workflow rule not found" });
  }

  // #202: reached by rule id rather than project id, so the project is resolved
  // through the rule. A rule belonging to a soft-deleted project is frozen with the
  // rest of that project for its 30-day recovery window (#187, PR-16).
  await getProjectWorkspaceId(existing.projectId);

  await db.delete(workflowRuleTable).where(eq(workflowRuleTable.id, id));

  return existing;
}

export default deleteWorkflowRule;
