import { eq } from "drizzle-orm";
import db, { schema } from "../database";

/** Project facts for a linked work item, used by the existing reach decision. */
export async function findWorkItemProjectOwner(workItemId: string) {
  const [owner] = await db
    .select({
      projectId: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(eq(schema.workItemTable.id, workItemId))
    .limit(1);
  return owner;
}
