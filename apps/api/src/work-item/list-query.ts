import { type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { workItemTable } from "../database/schema";
import {
  MAX_WORK_ITEM_INSTANT_MS,
  MIN_WORK_ITEM_INSTANT_MS,
} from "./date-bounds";

/**
 * #310: server-side sort/pagination for `GET /api/projects/{projectId}/work-items`.
 *
 * Field names and shapes are #306's own, not `api-design.md`'s generic collection
 * example (`sort=position|created_at|due_date|priority` / `order=asc|desc`) --
 * #310's acceptance criteria says explicitly: "using the same fields #306 exposes in
 * the URL, so the client sort goes away." #306's `apps/web/src/lib/routes.ts`
 * (`WORK_ITEM_SORT_FIELDS`) already ships `key | title | priority | dueDate` with a
 * `sort`/`dir` URL pair (not `sort`/`order`) -- this is the live contract the not-yet-
 * merged client will bind to once it switches over, so this route matches it exactly
 * rather than inventing a third shape. Cursor pagination itself (`cursor`/`limit`,
 * opaque cursor, `page.nextCursor`/`page.hasMore`) still follows
 * `docs/01-architecture/api-design.md:107-134` verbatim -- only the sort vocabulary
 * is #306's.
 */
export const WORK_ITEM_SORT_FIELDS = [
  "key",
  "title",
  "priority",
  "dueDate",
] as const;
export type WorkItemSortField = (typeof WORK_ITEM_SORT_FIELDS)[number];

export const WORK_ITEM_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type WorkItemSortDirection = (typeof WORK_ITEM_SORT_DIRECTIONS)[number];

export const DEFAULT_WORK_ITEM_LIST_LIMIT = 50;
export const MAX_WORK_ITEM_LIST_LIMIT = 200;

type PrimaryValue = string | number;

// `priority` is `text`, not an ordered enum in Postgres, so a plain text sort would
// order "high" < "low" < "medium" < "urgent" alphabetically -- meaningless against
// `work-items.md`'s "Urgent / High / Medium / Low" scale. Ranked via `CASE` instead.
// No-priority rows are given a per-direction sentinel rank (5 ascending, -1
// descending) so they always sort LAST regardless of direction. This sentinel is
// SAFE (unlike the `dueDate` one #320's security review found, S1): the rank domain
// is the fixed small set `{1,2,3,4}`, and `{5,-1}` are chosen to lie strictly
// outside it, with no possible real row ever producing that rank -- there is no
// "accepted input range" for a rank the way there is for a date, so no boundary tie
// is possible here.
const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const PRIORITY_NULL_RANK_ASC = 5;
const PRIORITY_NULL_RANK_DESC = -1;

function priorityRankSql(dir: WorkItemSortDirection): SQL<number> {
  const nullRank =
    dir === "asc" ? PRIORITY_NULL_RANK_ASC : PRIORITY_NULL_RANK_DESC;
  return sql<number>`case ${workItemTable.priority}
    when 'urgent' then 4
    when 'high' then 3
    when 'medium' then 2
    when 'low' then 1
    else ${nullRank}
  end`;
}

/**
 * `key`/`title`/`priority`'s sort expression -- `dueDate` is handled separately
 * (`dueDateIsNullExpr`/`workItemOrderBy`/`workItemCursorCondition` below), because a
 * plain sentinel-value trick for it turned out to be a real, reproduced bug (#320
 * security review, S1): the SQL sentinel and the cursor's own encoded sentinel used
 * different times of day, so `nextCursor` for a null-due row never actually advanced
 * past that row, and a client that walked every page would loop forever. Worse, the
 * comment claiming the sentinels were "far outside" the accepted range was false --
 * they were exactly `MIN_WORK_ITEM_INSTANT_MS`/`MAX_WORK_ITEM_INSTANT_MS`
 * (`schema.ts`), which are INCLUSIVE bounds, so a real item dated on either boundary
 * would tie with the null bucket. `key` sorts by `number`, not the `key` text column
 * -- `work_item.key` is `{project.slug}-{number}` (`work-items.md` WI-2), this route
 * is already scoped to one project, so every row shares the same slug, and a TEXT
 * sort of that string would order "PROJ-10" before "PROJ-2" (lexicographic, not
 * numeric). Sorting the underlying `number` column instead gives the numeric order a
 * human reading "key" actually expects.
 */
function primaryExpression(
  field: "key" | "title" | "priority",
  dir: WorkItemSortDirection,
): SQL<PrimaryValue> {
  switch (field) {
    case "key":
      return sql<PrimaryValue>`${workItemTable.number}`;
    case "title":
      return sql<PrimaryValue>`${workItemTable.title}`;
    case "priority":
      return priorityRankSql(dir);
  }
}

/**
 * `0` when `due_date` is set, `1` when it is null -- ALWAYS ascending, in both sort
 * directions, so null-due rows sort last regardless of `dir`, the same "no value
 * reads as least urgent" convention `priority` already uses. This is the explicit,
 * structural null-bucket the security review asked for in place of a magic sentinel
 * date: a row's bucket is a real, queryable fact (`due_date is null`), not a value
 * that has to be kept in sync with a date range defined somewhere else.
 */
function dueDateIsNullExpr(): SQL<number> {
  return sql<number>`case when ${workItemTable.dueDate} is null then 1 else 0 end`;
}

/** `ORDER BY <primary> <dir>, id ASC` for `key`/`title`/`priority` -- `id` (cuid2,
 * globally unique) is the stable tie-break every field needs: none of them is unique
 * per row, and even `number` (via `key`) is only unique per project, which this
 * route already is, but a plain `ORDER BY number` with no tie-break is still
 * formally allowed to reorder equal rows between calls under a concurrent write --
 * pinning `id` as a second key removes that ambiguity outright, which is what makes
 * cursor pagination over ties correct (no duplicate or skipped row across a page
 * boundary).
 *
 * `dueDate` orders by THREE keys instead: the null bucket first (`dueDateIsNullExpr`,
 * always ascending), then the date itself (per `dir`, meaningless within the null
 * bucket since every row there is null, so `id` alone decides order there), then
 * `id`. */
export function workItemOrderBy(
  field: WorkItemSortField,
  dir: WorkItemSortDirection,
): SQL[] {
  if (field === "dueDate") {
    return [
      sql`${dueDateIsNullExpr()} asc`,
      dir === "asc"
        ? sql`${workItemTable.dueDate} asc`
        : sql`${workItemTable.dueDate} desc`,
      sql`${workItemTable.id} asc`,
    ];
  }
  const primary = primaryExpression(field, dir);
  return [
    dir === "asc" ? sql`${primary} asc` : sql`${primary} desc`,
    sql`${workItemTable.id} asc`,
  ];
}

type CursorPayload = {
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  /** `null` only when `sort === "dueDate"` and `isNull` is true -- the boundary row
   * had no due date, so there is no date component to encode. */
  v: PrimaryValue | null;
  id: string;
  /** True only for a `dueDate` sort whose boundary row had no due date. Always
   * `false` for every other field -- this is what lets the cursor express "in the
   * null bucket" as its own state (#320 security review, S1's preferred fix)
   * instead of a magic value that has to coincide with nothing real. */
  isNull: boolean;
};

/** Opaque per `api-design.md` ("`?cursor=<opaque>`") -- base64url JSON. Not meant to be
 * decodable by a caller for any purpose other than round-tripping it back to this
 * route unmodified; nothing sensitive is encoded (the sort field/direction and the
 * boundary row's own sort value and id, all of which the caller already received in
 * the previous page's response body). */
export function encodeWorkItemCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

const CURSOR_ID_MAX_LENGTH = 64;
const PRIORITY_CURSOR_VALUES_BY_DIR: Record<WorkItemSortDirection, number[]> = {
  asc: [1, 2, 3, 4, PRIORITY_NULL_RANK_ASC],
  desc: [1, 2, 3, 4, PRIORITY_NULL_RANK_DESC],
};

function invalidCursor(detail: string): never {
  throw new HTTPException(400, {
    message: `cursor: invalid value (${detail})`,
  });
}

/**
 * Throws 400 (the project's standard plain-text error envelope, via `HTTPException`)
 * for anything that isn't a well-formed cursor for the CURRENT `sort`/`dir` -- a
 * cursor minted for a different sort field or direction cannot be continued
 * (its stored primary value has no meaning under a different order), so this is
 * rejected rather than silently reinterpreted, which could otherwise produce a
 * duplicate-or-gap page under a sort the caller never asked to continue.
 *
 * #320 security review, S2: a cursor is caller-supplied and unsigned (deliberately
 * -- `api-design.md`'s "opaque" means "don't parse it", not "trust it blindly";
 * every field in it is a value the caller already received in the previous page, so
 * signing it would add nothing). Before this fix, only the WIRE SHAPE of `v` (string
 * or number) and `id` (non-empty string) were checked -- a well-typed but
 * out-of-range or wrongly-typed-for-this-field value (a string `v` for `key`, a
 * `1e400`-overflowed `Infinity`, a `priority` rank outside `{-1,1,2,3,4,5}`, an
 * unparseable or out-of-range `dueDate`) reached the SQL layer and came back as a
 * raw Postgres error (`22P02`/`22003`/`22007`) that this route's `onError` masks as
 * a generic 500 -- never leaking driver detail, but still a 500 where the route's
 * own contract promises 400 for a malformed request. Every branch below rejects at
 * the validation boundary instead, per field, matching the exact value space that
 * field's real cursors can ever contain.
 */
export function decodeWorkItemCursor(
  cursor: string,
  expected: { sort: WorkItemSortField; dir: WorkItemSortDirection },
): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  const candidate = parsed as Record<string, unknown>;
  const { sort, dir, v, id, isNull } = candidate;

  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > CURSOR_ID_MAX_LENGTH ||
    id.includes("\u0000")
  ) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  if (typeof isNull !== "boolean") {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  if (sort !== expected.sort || dir !== expected.dir) {
    throw new HTTPException(400, {
      message: "cursor: does not match the current sort/dir",
    });
  }

  switch (expected.sort) {
    case "key": {
      if (
        isNull ||
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < -2147483648 ||
        v > 2147483647
      ) {
        invalidCursor("sort=key needs an integer work_item.number");
      }
      break;
    }
    case "title": {
      if (
        isNull ||
        typeof v !== "string" ||
        v.length === 0 ||
        v.length > 500 ||
        v.includes("\u0000")
      ) {
        invalidCursor("sort=title needs a non-empty, NUL-free string");
      }
      break;
    }
    case "priority": {
      const allowed = PRIORITY_CURSOR_VALUES_BY_DIR[expected.dir];
      if (
        isNull ||
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        !allowed.includes(v)
      ) {
        invalidCursor(`sort=priority needs one of ${allowed.join(",")}`);
      }
      break;
    }
    case "dueDate": {
      if (isNull) {
        if (v !== null) {
          invalidCursor("sort=dueDate with isNull=true must carry v=null");
        }
      } else {
        if (typeof v !== "string" || v.includes("\u0000")) {
          invalidCursor("sort=dueDate needs an ISO date-time string");
        }
        const ms = Date.parse(v);
        if (
          !Number.isFinite(ms) ||
          ms < MIN_WORK_ITEM_INSTANT_MS ||
          ms > MAX_WORK_ITEM_INSTANT_MS
        ) {
          invalidCursor(
            "sort=dueDate value must be a real instant inside the accepted range",
          );
        }
      }
      break;
    }
  }

  return {
    sort: expected.sort,
    dir: expected.dir,
    v: v as PrimaryValue | null,
    id,
    isNull,
  };
}

/** The keyset continuation clause for `key`/`title`/`priority` -- strictly past the
 * boundary row in the requested direction, on the SAME `(primary, id)` tuple
 * `workItemOrderBy` orders by. */
function nonDueDateCursorCondition(
  field: "key" | "title" | "priority",
  dir: WorkItemSortDirection,
  cursor: CursorPayload,
): SQL {
  const primary = primaryExpression(field, dir);
  const op = dir === "asc" ? sql`>` : sql`<`;
  // NOT a plain `(primary, id) op (cursor.v, cursor.id)` row-value comparison --
  // Postgres's row comparison applies the SAME operator to every component, but
  // `id` tie-break is ALWAYS ascending (`workItemOrderBy`'s own trailing `id asc`),
  // independent of `dir`. For `dir=desc`, a row-value `<` would require `id <
  // cursor.id` on a tie, silently skipping the next tied row (which has a LARGER
  // id, per ascending tie-break) and producing a real gap in the walk -- caught
  // live by a `priority` tie walked in `desc` (two rows sharing a rank, `limit=1`).
  // Writing the OR-expansion directly, with an explicit `id > cursor.id` tie-break
  // regardless of `dir`, is what actually matches the order `workItemOrderBy`
  // produces.
  return sql`(${primary} ${op} ${cursor.v}) or (${primary} = ${cursor.v} and ${workItemTable.id} > ${cursor.id})`;
}

/**
 * The keyset continuation clause for `dueDate`, matching `workItemOrderBy`'s own
 * two-bucket order exactly (#320 security review, S1's fix):
 *
 * - Cursor row was IN the null bucket: every remaining row in the null bucket sorts
 *   purely by `id` (the date component ties for all of them, since it's null for
 *   all of them) -- `id > cursor.id` is the whole condition, independent of `dir`
 *   (the null bucket's own internal order is always `id` ascending, same as
 *   `workItemOrderBy`'s trailing tie-break).
 * - Cursor row was in the REAL-DATE bucket: the remaining rows are every row still
 *   in the real-date bucket that is past this one (the ordinary tuple comparison,
 *   safe here because `due_date` is provably NOT NULL on that side of the OR), PLUS
 *   every row in the null bucket -- which, per `workItemOrderBy`, always sorts after
 *   every real-date row regardless of `dir`.
 */
function dueDateCursorCondition(
  dir: WorkItemSortDirection,
  cursor: CursorPayload,
): SQL {
  const isNullExpr = dueDateIsNullExpr();

  if (cursor.isNull) {
    return sql`(${isNullExpr} = 1 and ${workItemTable.id} > ${cursor.id})`;
  }

  const op = dir === "asc" ? sql`>` : sql`<`;
  // The cursor's `v` is an ISO string (JSON has no date type); cast the bound
  // parameter back to `timestamp` so the comparison's two sides are the same type.
  const cursorDate = sql`(${cursor.v}::timestamp)`;
  // Same reasoning as `nonDueDateCursorCondition` above: no row-value tuple compare
  // (it would apply `dir`'s operator to the `id` tie-break too, which must always be
  // ascending) -- the OR-expansion, with an explicit `id > cursor.id` tie-break.
  return sql`(${isNullExpr} = 1) or (${isNullExpr} = 0 and ((${workItemTable.dueDate} ${op} ${cursorDate}) or (${workItemTable.dueDate} = ${cursorDate} and ${workItemTable.id} > ${cursor.id})))`;
}

/** The keyset `WHERE` continuation clause -- this is what makes the walk gapless and
 * duplicate-free across pages even while rows are being concurrently inserted or
 * updated elsewhere in the project (a `LIMIT`/`OFFSET` page cannot make that
 * guarantee; that is precisely why `api-design.md` mandates cursor pagination for
 * this surface). */
export function workItemCursorCondition(
  field: WorkItemSortField,
  dir: WorkItemSortDirection,
  cursor: CursorPayload,
): SQL {
  if (field === "dueDate") {
    return dueDateCursorCondition(dir, cursor);
  }
  return nonDueDateCursorCondition(field, dir, cursor);
}

/** Builds the next cursor's `(v, isNull)` pair from the last row of the CURRENT page
 * (before the lookahead row, if any, is dropped) -- `row` must be the same shape
 * `listWorkItems` selects (`number`, `title`, `priority`, `dueDate` are all already
 * resolved server-side there, so this only needs to pick the one the current sort
 * uses). */
export function primaryValueForCursor(
  field: WorkItemSortField,
  row: {
    number: number;
    title: string;
    priority: string | null;
    dueDate: Date | null;
  },
  dir: WorkItemSortDirection,
): { v: PrimaryValue | null; isNull: boolean } {
  switch (field) {
    case "key":
      return { v: row.number, isNull: false };
    case "title":
      return { v: row.title, isNull: false };
    case "priority": {
      const nullRank =
        dir === "asc" ? PRIORITY_NULL_RANK_ASC : PRIORITY_NULL_RANK_DESC;
      return {
        v: row.priority ? (PRIORITY_RANK[row.priority] ?? nullRank) : nullRank,
        isNull: false,
      };
    }
    case "dueDate":
      return row.dueDate
        ? { v: row.dueDate.toISOString(), isNull: false }
        : { v: null, isNull: true };
  }
}
