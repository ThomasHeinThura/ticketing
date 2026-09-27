import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, workItemTable } from "../../database/schema";

// #23's fourth slice: `GET /api/work-items/{key}/activity` (`work_item:read`, plus
// reach). Issue #292 / the merged `activity.ts` module already built the WRITE side
// (`recordWorkItemActivity`, wired into #271's create/update and #30's assign) -- this
// is purely the READ over already-recorded rows the task description pointed at, no new
// write path.
//
// VISIBILITY: this route does NOT filter `internal` rows by caller type. Grepped the
// rest of this codebase for a precedent first (per this project's own "verify against
// source" rule) -- there is none: `comment/controllers/get-comments.ts` (the closest
// analogous read, inherited from kaneo) returns every row unfiltered too, and no route
// anywhere assembles a live customer-portal caller identity yet (`work-item/index.ts`'s
// own file comment already notes this same gap for reach). `activity.visibility` exists
// precisely so a FUTURE portal-facing read can filter by it (`CA-7`) -- this route is
// gated by `requireWorkspaceCapability("work_item:read")`, today reachable only by a
// staff workspace member, so there is no live caller for whom hiding `internal` rows
// would currently matter. Flagged in the PR body as a narrower slice than a full
// portal-safe projection, not a silent gap.
//
// PAGINATION: opaque cursor over `(created_at desc, id desc)` -- NOT `(created_at desc,
// seq desc)`, even though that is the schema's own declared index order
// (`activity_work_item_id_created_at_idx`) and what the write side's own doc comment
// most naturally continues -- `recordWorkItemActivity`'s doc comment is explicit that
// `seq` must never appear in an API response (a deliberate exception to "surrogate ids
// are never sequential" that depends entirely on that premise holding), and encoding it
// even inside an opaque cursor token risks becoming exactly the leak that comment warns
// against being tightened later. `id` (cuid2, globally unique) is not perfectly
// correlated with insertion order the way `seq` is, but it IS a legitimate, collision-
// free tie-break for two rows sharing one `created_at` -- correctness (no duplicate/gap
// across a page boundary) holds either way; only the tie-break's ORDER differs from the
// index's own, which does not change what a caller ever sees, only how millisecond-tied
// rows interleave against each other within one page.

export const DEFAULT_WORK_ITEM_ACTIVITY_LIMIT = 50;
export const MAX_WORK_ITEM_ACTIVITY_LIMIT = 200;

export type WorkItemActivityCursor = { createdAt: string; id: string };

export function encodeActivityCursor(cursor: WorkItemActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeActivityCursor(raw: string): WorkItemActivityCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  const { createdAt, id } = parsed as Record<string, unknown>;
  if (
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt)) ||
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 64 ||
    id.includes("\u0000")
  ) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  return { createdAt, id };
}

export async function listWorkItemActivity(
  key: string,
  workspaceId: string,
  options: { cursor?: string; limit?: number },
) {
  const item = await db.query.workItemTable.findFirst({
    where: eq(workItemTable.key, key),
  });
  if (!item || item.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  const limit = options.limit ?? DEFAULT_WORK_ITEM_ACTIVITY_LIMIT;

  const conditions: SQL[] = [eq(activityTable.workItemId, item.id)];
  if (options.cursor) {
    const cursor = decodeActivityCursor(options.cursor);
    const cursorDate = new Date(cursor.createdAt);
    // Continuation clause matching this query's own order (`created_at desc, id
    // desc`): strictly older rows, or same-instant rows with a strictly smaller id
    // (the descending tie-break) -- the OR-expansion, same shape
    // `list-query.ts`'s `nonDueDateCursorCondition` uses and explains why a row-value
    // tuple compare would be wrong here (the tie-break's direction cannot be assumed
    // to match the primary column's).
    const continuation = or(
      lt(activityTable.createdAt, cursorDate),
      and(
        eq(activityTable.createdAt, cursorDate),
        lt(activityTable.id, cursor.id),
      ),
    );
    if (continuation) {
      conditions.push(continuation);
    }
  }

  const rows = await db
    .select({
      id: activityTable.id,
      workItemId: activityTable.workItemId,
      actorId: activityTable.actorId,
      actorType: activityTable.actorType,
      verb: activityTable.verb,
      field: activityTable.field,
      oldValue: activityTable.oldValue,
      newValue: activityTable.newValue,
      payload: activityTable.payload,
      visibility: activityTable.visibility,
      workflowVersionId: activityTable.workflowVersionId,
      createdAt: activityTable.createdAt,
    })
    .from(activityTable)
    .where(and(...conditions))
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page.at(-1);

  return {
    data: page,
    page: {
      hasMore,
      nextCursor:
        hasMore && lastRow
          ? encodeActivityCursor({
              createdAt: lastRow.createdAt.toISOString(),
              id: lastRow.id,
            })
          : null,
    },
  };
}

export default listWorkItemActivity;
