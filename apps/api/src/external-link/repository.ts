import { eq } from "drizzle-orm";
import type db from "../database";
import { externalLinkTable } from "../database/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listExternalLinksForTask(executor: Executor, taskId: string) {
  return executor.query.externalLinkTable.findMany({
    where: eq(externalLinkTable.taskId, taskId),
  });
}
