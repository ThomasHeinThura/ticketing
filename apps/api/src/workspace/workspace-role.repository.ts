import { eq } from "drizzle-orm";
import db, { schema } from "../database";

/** Materialized role rows for one workspace; this read does not join a caller transaction. */
export async function listWorkspaceRoleRows(workspaceId: string) {
  return await db
    .select()
    .from(schema.workspaceRoleTable)
    .where(eq(schema.workspaceRoleTable.workspaceId, workspaceId));
}
