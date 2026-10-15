import { listCannedResponsesInWorkspace } from "../repository";

export async function listCannedResponses(workspaceId: string) {
  return listCannedResponsesInWorkspace(workspaceId);
}

export default listCannedResponses;
