import { eq } from "drizzle-orm";
import db from "../database";
import { cannedResponseTable } from "../database/schema";

export function listCannedResponsesQuery(workspaceId: string) {
  return db
    .select()
    .from(cannedResponseTable)
    .where(eq(cannedResponseTable.workspaceId, workspaceId))
    .orderBy(cannedResponseTable.name);
}

export function getCannedResponseWorkspaceQuery(id: string) {
  return db
    .select({ workspaceId: cannedResponseTable.workspaceId })
    .from(cannedResponseTable)
    .where(eq(cannedResponseTable.id, id))
    .limit(1);
}
