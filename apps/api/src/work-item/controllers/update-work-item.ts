import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, workItemTable } from "../../database/schema";

export type UpdateWorkItemInput = {
  title?: string;
  description?: unknown;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  startDate?: Date | null;
  dueDate?: Date | null;
};

/**
 * Thrown on a `WI-7` version mismatch. Carries both versions so the route handler can
 * build the structured 409 body (`workItemVersionConflictSchema`) -- a plain
 * `HTTPException(409, { message })` cannot carry the extra fields, since Hono's default
 * `getResponse()` only ever emits the message as plain text.
 */
export class WorkItemVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Version mismatch: expected version ${assertedVersion}, but the work item is now at version ${currentVersion}`,
    );
    this.name = "WorkItemVersionConflictError";
  }
}

/**
 * `PATCH /api/work-items/{key}` (`work_item:update`, plus reach -- `require-work-item-
 * reach.ts` already resolved this key to a row's `workspaceId` before this runs, the same
 * middleware `get-work-item.ts` relies on).
 *
 * Implements `WI-7` (optimistic concurrency) and `WI-8` (title/description/priority/dates
 * editable by anyone with `work_item:update`). Label and custom-field editing (also named
 * in WI-8), state changes (`WI-9`) and assignment (`WI-10`) are explicitly NOT here -- see
 * `schema.ts`'s own comment on `updateWorkItemBody` and this PR's body for why.
 *
 * `WI-7`'s compare-and-swap is the `WHERE ... AND version = $assertedVersion` clause ON
 * the `UPDATE` itself -- a single atomic statement, not a separate SELECT-then-UPDATE
 * (which would race: two concurrent callers could each read version N, each pass an
 * application-level check, and both write). Postgres's own row-level locking during the
 * `UPDATE` serialises concurrent attempts against the same row, so exactly one concurrent
 * writer asserting the same starting version can ever match this WHERE clause and commit;
 * every other one gets zero rows back and is answered with a 409 built from the row's
 * true current state.
 *
 * A zero-row result is ambiguous on its own (wrong version, or the row no longer exists --
 * e.g. deleted in the moment between the reach-check middleware and this transaction), so
 * the current row is re-loaded, scoped by the SAME `key`+`workspaceId` pair the CAS itself
 * used, to distinguish the two and to report the real current version in the 409 body.
 */
export async function updateWorkItem(
  key: string,
  workspaceId: string,
  assertedVersion: number,
  input: UpdateWorkItemInput,
) {
  const values: Partial<typeof workItemTable.$inferInsert> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.description !== undefined) values.description = input.description;
  if (input.priority !== undefined) values.priority = input.priority;
  if (input.startDate !== undefined) values.startDate = input.startDate;
  if (input.dueDate !== undefined) values.dueDate = input.dueDate;

  // #202 / PR #204's freeze invariant, closing the reach-check-to-UPDATE race: the
  // `requireWorkItemReach` middleware already refuses a soft-deleted project's work item
  // (404), but that check and this write are two separate statements -- the project could
  // be soft-deleted in between. The same `project.deleted_at IS NULL` condition is applied
  // directly to the CAS itself (as an `EXISTS`, since `UPDATE ... WHERE` cannot join) so a
  // project deleted in that window can never have its work items written to, and to the
  // re-read below so a zero-row CAS result reports 404, not a confusing 409, when the
  // project (not the version) is why it didn't match.
  const projectNotDeleted = sql`EXISTS (SELECT 1 FROM ${projectTable} WHERE ${projectTable.id} = ${workItemTable.projectId} AND ${projectTable.deletedAt} IS NULL)`;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workItemTable)
      .set({ ...values, version: sql`${workItemTable.version} + 1` })
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
          eq(workItemTable.version, assertedVersion),
          projectNotDeleted,
        ),
      )
      .returning();

    if (updated) {
      return updated;
    }

    const [current] = await tx
      .select({ version: workItemTable.version })
      .from(workItemTable)
      .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      );

    if (!current) {
      // Genuinely gone -- deleted, moved out of this workspace, or its project was
      // soft-deleted -- since the reach-check middleware ran. A race, not a version
      // mismatch. 404, matching that middleware's own "not there" outcome for this route
      // rather than a confusing 409.
      throw new HTTPException(404, { message: "Work item not found" });
    }

    throw new WorkItemVersionConflictError(assertedVersion, current.version);
  });
}

export default updateWorkItem;
