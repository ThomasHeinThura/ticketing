import { eq } from "drizzle-orm";
import db from "../database";
import { externalLinkTable } from "../database/schema";

/** Every external link attached to a task (issue #580). */
export async function listExternalLinksByTask(taskId: string) {
  return db.query.externalLinkTable.findMany({
    where: eq(externalLinkTable.taskId, taskId),
  });
}
