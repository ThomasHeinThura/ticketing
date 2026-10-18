import type { ResolvedIdentity } from "@taskdesk/permissions";
import { listCannedResponsesForWorkItem } from "../repository";

export async function listCannedResponses(
  identity: ResolvedIdentity,
  workItemKey: string,
) {
  return listCannedResponsesForWorkItem(identity, workItemKey);
}

export default listCannedResponses;
