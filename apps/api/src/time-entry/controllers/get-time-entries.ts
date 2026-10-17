import { listTimeEntriesWithUserByTask } from "../repository";

async function getTimeEntriesByTaskId(taskId: string) {
  const timeEntries = await listTimeEntriesWithUserByTask(taskId);

  return timeEntries;
}

export default getTimeEntriesByTaskId;
