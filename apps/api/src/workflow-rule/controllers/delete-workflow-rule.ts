import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { deleteWorkflowRuleById, findWorkflowRuleById } from "../repository";

async function deleteWorkflowRule(identity: ResolvedIdentity, id: string) {
  const existing = await findWorkflowRuleById(identity, id);

  if (!existing) {
    throw new HTTPException(404, { message: "Workflow rule not found" });
  }

  // #202: reached by rule id rather than project id, so the project is resolved
  // through the rule. A rule belonging to a soft-deleted project is frozen with the
  // rest of that project for its 30-day recovery window (#187, PR-16).
  await getProjectWorkspaceId(existing.projectId);

  const deleted = await deleteWorkflowRuleById(identity, id);
  if (!deleted)
    throw new HTTPException(404, { message: "Workflow rule not found" });
  return deleted;
}

export default deleteWorkflowRule;
