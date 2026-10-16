import type { ResolvedIdentity } from "@taskdesk/permissions";
import { listWorkflowsInWorkspace } from "../repository";

async function listWorkflows(identity: ResolvedIdentity, workspaceId: string) {
  return listWorkflowsInWorkspace(identity, workspaceId);
}

export default listWorkflows;
