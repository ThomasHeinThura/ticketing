import { listWorkflowsInWorkspace } from "../repository";

async function listWorkflows(workspaceId: string) {
  return listWorkflowsInWorkspace(workspaceId);
}

export default listWorkflows;
