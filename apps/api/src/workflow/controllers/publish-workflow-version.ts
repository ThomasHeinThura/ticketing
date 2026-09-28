import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  personTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
} from "../../database/schema";

/**
 * Publishes `number` for `workflowId`: stamps `published_at`/`published_by` on that
 * version and sets `workflow.active_version_id` to it (`WF-7`). Immutable once
 * published (`WF-6`) -- this route does not enforce that beyond writing
 * `published_at` once; nothing in this PR's scope offers an "edit a published
 * version" route to enforce it against.
 */
async function publishWorkflowVersion(
  workflowId: string,
  number: number,
  userId: string,
) {
  const [version] = await db
    .select()
    .from(workflowVersionTable)
    .where(
      and(
        eq(workflowVersionTable.workflowId, workflowId),
        eq(workflowVersionTable.number, number),
      ),
    )
    .limit(1);

  if (!version) {
    throw new HTTPException(404, { message: "Workflow version not found" });
  }

  const [caller] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);

  return db.transaction(async (tx) => {
    const [published] = await tx
      .update(workflowVersionTable)
      .set({ publishedAt: new Date(), publishedBy: caller?.id ?? null })
      .where(eq(workflowVersionTable.id, version.id))
      .returning();

    await tx
      .update(workflowTable)
      .set({ activeVersionId: version.id })
      .where(eq(workflowTable.id, workflowId));

    const transitions = await tx
      .select()
      .from(workflowTransitionTable)
      .where(eq(workflowTransitionTable.versionId, version.id));

    return { ...published, transitions };
  });
}

export default publishWorkflowVersion;
