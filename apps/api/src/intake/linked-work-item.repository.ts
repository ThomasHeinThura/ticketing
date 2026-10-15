import { eq } from "drizzle-orm";
import db, { schema } from "../database";

/**
 * The project facts a submission's linked work item is reached through, or `undefined`
 * (issue #580). Kept out of `intake/repository.ts` because that module imports
 * `submission-linked-work-item.ts`, which owns the reach rule and calls this.
 */
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
