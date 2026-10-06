import { listWorkflowsQuery } from "../repository";

async function listWorkflows(workspaceId: string) {
  return listWorkflowsQuery(workspaceId);
}

export default listWorkflows;
