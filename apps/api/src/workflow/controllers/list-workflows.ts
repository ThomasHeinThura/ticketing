import { eq } from "drizzle-orm";
import db from "../../database";
import { workflowTable } from "../../database/schema";

async function listWorkflows(workspaceId: string) {
  return db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.workspaceId, workspaceId));
}

export default listWorkflows;
