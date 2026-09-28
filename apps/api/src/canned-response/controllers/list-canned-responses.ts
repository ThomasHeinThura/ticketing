import { eq } from "drizzle-orm";
import db from "../../database";
import { cannedResponseTable } from "../../database/schema";

export async function listCannedResponses(workspaceId: string) {
  return db
    .select()
    .from(cannedResponseTable)
    .where(eq(cannedResponseTable.workspaceId, workspaceId))
    .orderBy(cannedResponseTable.name);
}

export default listCannedResponses;
