import db from "../../database";
import { listTimeEntriesByTaskId } from "../repository";

async function getTimeEntriesByTaskId(taskId: string) {
  const timeEntries = await listTimeEntriesByTaskId(db, taskId);

  return timeEntries;
}

export default getTimeEntriesByTaskId;
