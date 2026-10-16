import type { ResolvedIdentity } from "@taskdesk/permissions";
import { listTimeEntriesWithUserByTask } from "../repository";

async function getTimeEntriesByTaskId(
  identity: ResolvedIdentity,
  taskId: string,
) {
  return listTimeEntriesWithUserByTask(identity, taskId);
}

export default getTimeEntriesByTaskId;
