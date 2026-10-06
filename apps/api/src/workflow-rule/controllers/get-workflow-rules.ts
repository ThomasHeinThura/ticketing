import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { listWorkflowRulesQuery } from "../repository";

async function getWorkflowRules(projectId: string) {
  // #202: this route's subject IS a project (`workspaceAccess.fromProject`), so a
  // soft-deleted project's rules must be gone for ordinary use during its 30-day
  // recovery window (#187, PR-16). The controller never touched `projectTable`
  // itself, so nothing else in the chain applied the exclusion.
  await getProjectWorkspaceId(projectId);

  const rules = await listWorkflowRulesQuery(projectId);

  return rules;
}

export default getWorkflowRules;
