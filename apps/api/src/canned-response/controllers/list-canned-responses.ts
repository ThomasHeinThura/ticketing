import { listCannedResponsesQuery } from "../repository";

export async function listCannedResponses(workspaceId: string) {
  return listCannedResponsesQuery(workspaceId);
}

export default listCannedResponses;
