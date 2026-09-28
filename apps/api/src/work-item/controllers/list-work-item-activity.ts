import {
  and,
  desc,
  eq,
  lt,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  commentTable,
  workItemTable,
} from "../../database/schema";

// #23's fourth slice: `GET /api/work-items/{key}/activity` (`work_item:read`, plus
// reach). Issue #292 / the merged `activity.ts` module already built the WRITE side
// (`recordWorkItemActivity`, wired into #271's create/update and #30's assign) -- this
// is purely the READ over already-recorded rows the task description pointed at, no new
// write path.
//
// ISSUE #452: `comments-and-activity.md`'s "one stream showing everything" was never
// actually true here -- this route only ever queried `activityTable`, never `comment`,
// even though the spec's own `## API` section documents exactly one read route for the
// combined stream (no separate `GET .../comments` is listed anywhere in that section) and
// the "Screens" section already describes a single stream with a client-side filter
// between "everything", "comments only" and "public only". So this is the fix, not a new
// endpoint: every row below now also queries `commentTable` for the same work item and
// merges the two result sets by `(created_at desc, id desc)`, tagging each with `kind`
// ("activity" | "comment") so a caller can tell them apart and a client can still filter
// client-side exactly as the spec describes.
//
// VISIBILITY: unchanged from before this issue -- this route does NOT filter `internal`
// rows (activity OR comment) by caller type. Grepped the rest of this codebase for a
// precedent first (per this project's own "verify against source" rule) -- there is
// none: `comment/controllers/get-comments.ts` (the closest analogous read, inherited
// from kaneo) returns every row unfiltered too, and no route anywhere assembles a live
// customer-portal caller identity yet (`work-item/index.ts`'s own file comment already
// notes this same gap for reach). `visibility` exists on both tables precisely so a
// FUTURE portal-facing read can filter by it (`CA-7`/the visibility table in
// `comments-and-activity.md`) -- this route is gated by
// `requireWorkspaceCapability("work_item:read")`, today reachable only by a staff
// workspace member, so there is no live caller for whom hiding `internal` rows would
// currently matter. Flagged in the PR body as a narrower slice than a full portal-safe
// projection, not a silent gap -- exactly the same call this route's own prior version
// already made for activity rows alone.
//
// PAGINATION: opaque cursor over the MERGED `(created_at desc, id desc)` order --
// unchanged shape from before (`WorkItemActivityCursor`), but the id tie-break may now
// belong to either table's own cuid2 id space. Correctness of the merge: this fetches up
// to `limit + 1` rows from EACH table (both filtered by the same cursor continuation,
// both already sorted `created_at desc, id desc`), merge-sorts the two fetched sets by
// that same order, and takes the first `limit` as the page. This is the standard
// top-K-of-a-union-of-sorted-streams pattern: the true top-`limit` merged rows can
// include at most `limit` rows from either single source, so fetching `limit + 1` from
// each is always a superset of what the page needs, and `hasMore` (`mergedPool.length >
// limit`) is exactly correct -- for any split of the remaining counts between the two
// tables, `min(remainingA, limit+1) + min(remainingB, limit+1) > limit` if and only if
// `remainingA + remainingB > limit` (proof: if both remainders individually stay at or
// under `limit`, the sum fetched equals the true sum; the moment either remainder alone
// reaches `limit + 1`, the fetched sum already exceeds `limit` on its own, and the true
// total does too since it is at least that one table's remainder).
//
// #452 DELTA (Opus B1, blocking, found live): this proof depends on the database's own
// `ORDER BY`/continuation-filter order agreeing EXACTLY with the in-memory merge's
// `(createdAt.getTime(), id)` order -- and for comments, it didn't. `comment.created_at`
// is a DB-set `DEFAULT now()` column, stored to the MICROSECOND (both write paths,
// `create-comment.ts` and `transition-work-item.ts`'s note-as-comment path, rely on the
// column default). `activity.created_at` is written from a JS `Date` in application code
// (`activity.ts`), already millisecond-precision at the source -- no fix needed there.
// A JS `Date` cannot hold more than millisecond precision, so the in-memory sort key and
// the opaque cursor (`lastRow.createdAt.toISOString()`) are BOTH already truncated to
// milliseconds -- but the old code compared that millisecond-precision cursor value
// directly against the RAW, microsecond-precision `comment.created_at` column in SQL. Two
// comments in the same millisecond then broke the `eq(...)` tie-break outright: it could
// never match a column value carrying nonzero microseconds, so every comment but the
// first written in that millisecond silently never reappeared on ANY page -- reproduced
// live (3 comments microseconds apart in the same millisecond, `limit=1`: only 1 of 3 was
// ever returned). Fixed by truncating `comment.created_at` to milliseconds with
// `date_trunc('milliseconds', ...)` in both the comment query's `ORDER BY` and its
// continuation filter (`commentCreatedAtMs` below) -- this makes the database's chosen
// top-`fetchLimit` comment rows, and their ordering within that set, agree exactly with
// the millisecond-precision order the in-memory merge already assumed. The SELECTed
// `createdAt` field itself is left as the raw column (unchanged): node-postgres already
// parses a `timestamp` column into a JS `Date`, which itself cannot represent more than
// millisecond precision, so the value returned to the caller and encoded into the next
// cursor was never the bug -- only the SQL-side comparison was.

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

type ActivityStreamRow =
  | {
      kind: "activity";
      id: string;
      workItemId: string;
      actorId: string | null;
      actorType: string;
      verb: string;
      field: string | null;
      oldValue: unknown;
      newValue: unknown;
      payload: unknown;
      visibility: string;
      workflowVersionId: string | null;
      createdAt: Date;
    }
  | {
      kind: "comment";
      id: string;
      workItemId: string;
      workspaceId: string;
      authorId: string | null;
      actorType: string;
      body: unknown;
      visibility: string;
      activityId: string | null;
      editedAt: Date | null;
      deletedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    };

// `createdAtExpr` accepts either a plain column (activity's own, already
// millisecond-precision) or a computed `SQL` expression (the comment query passes its
// millisecond-truncated `commentCreatedAtMs` below, per the #452 delta doc comment
// above) -- both satisfy `SQLWrapper`, which is all `lt`/`eq` actually require.
function cursorContinuationOn(
  createdAtExpr: SQLWrapper,
  idColumn: typeof activityTable.id | typeof commentTable.id,
  cursorDate: Date,
  cursorId: string,
): SQL | undefined {
  return or(
    lt(createdAtExpr, cursorDate),
    and(eq(createdAtExpr, cursorDate), lt(idColumn, cursorId)),
  );
}

// #452 delta (Opus B1): see the controller's own doc comment. `date_trunc('milliseconds',
// ...)` on `comment.created_at`'s raw, microsecond-precision value -- used for THIS
// query's own `ORDER BY` and continuation filter only, never for what is SELECTed (the
// raw column is still what's returned to the caller; a JS `Date` cannot represent more
// than millisecond precision anyway, so nothing is lost by selecting the raw column).
const commentCreatedAtMs = sql`date_trunc('milliseconds', ${commentTable.createdAt})`;

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
  const fetchLimit = limit + 1;

  const cursor = options.cursor
    ? decodeActivityCursor(options.cursor)
    : undefined;
  const cursorDate = cursor ? new Date(cursor.createdAt) : undefined;

  const activityConditions: SQL[] = [eq(activityTable.workItemId, item.id)];
  const commentConditions: SQL[] = [eq(commentTable.workItemId, item.id)];
  if (cursor && cursorDate) {
    const activityContinuation = cursorContinuationOn(
      activityTable.createdAt,
      activityTable.id,
      cursorDate,
      cursor.id,
    );
    if (activityContinuation) activityConditions.push(activityContinuation);
    const commentContinuation = cursorContinuationOn(
      commentCreatedAtMs,
      commentTable.id,
      cursorDate,
      cursor.id,
    );
    if (commentContinuation) commentConditions.push(commentContinuation);
  }

  const [activityRows, commentRows] = await Promise.all([
    db
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
      .where(and(...activityConditions))
      .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
      .limit(fetchLimit),
    db
      .select({
        id: commentTable.id,
        workItemId: commentTable.workItemId,
        workspaceId: commentTable.workspaceId,
        authorId: commentTable.authorId,
        actorType: commentTable.actorType,
        body: commentTable.body,
        visibility: commentTable.visibility,
        activityId: commentTable.activityId,
        editedAt: commentTable.editedAt,
        deletedAt: commentTable.deletedAt,
        createdAt: commentTable.createdAt,
        updatedAt: commentTable.updatedAt,
      })
      .from(commentTable)
      .where(and(...commentConditions))
      .orderBy(desc(commentCreatedAtMs), desc(commentTable.id))
      .limit(fetchLimit),
  ]);

  const merged: ActivityStreamRow[] = [
    ...activityRows.map((row) => ({ kind: "activity" as const, ...row })),
    ...commentRows.map((row) => ({ kind: "comment" as const, ...row })),
  ].sort((a, b) => {
    const byTime = b.createdAt.getTime() - a.createdAt.getTime();
    if (byTime !== 0) return byTime;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1; // descending id tie-break, matching each source query
  });

  const hasMore = merged.length > limit;
  const page = hasMore ? merged.slice(0, limit) : merged;
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
