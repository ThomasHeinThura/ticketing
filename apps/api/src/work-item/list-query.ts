import { type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { workItemTable } from "../database/schema";

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

/**
 * The SQL expression each sort field actually orders by, plus how to decode a
 * cursor's stored primary value back into the same type for the keyset comparison.
 *
 * `key` sorts by `number`, not the `key` text column. `work_item.key` is
 * `{project.slug}-{number}` (`work-items.md` WI-2) -- this route is already scoped to
 * one project, so every row shares the same slug, and a TEXT sort of that string
 * would order "PROJ-10" before "PROJ-2" (lexicographic, not numeric). Sorting the
 * underlying `number` column instead gives the numeric order a human reading "key"
 * actually expects, with no behaviour difference for the caller (the two orders
 * coincide for any single-digit-consistent range and diverge only where a naive text
 * sort would visibly be wrong). Judgment call, flagged in the PR body.
 *
 * `priority` is `text`, not an ordered enum in Postgres, so a plain text sort would
 * order "high" < "low" < "medium" < "urgent" alphabetically -- meaningless against
 * `work-items.md`'s "Urgent / High / Medium / Low" scale. Ranked via `CASE` instead
 * (urgent=4 .. low=1). No-priority rows are given a per-direction sentinel rank
 * (5 ascending, -1 descending) so they always sort LAST regardless of direction,
 * rather than landing in the middle of the scale (`null`/`0` would sort first
 * ascending) or swapping ends when direction flips -- "no priority" reads as "least
 * urgent" either way, matching this being the more useful default for a work queue.
 *
 * `dueDate` is nullable `timestamp`. Same "no value sorts last, both directions"
 * treatment, via a per-direction sentinel date far outside `work_item`'s own accepted
 * input range (`schema.ts`'s `MIN_WORK_ITEM_INSTANT_MS`/`MAX_WORK_ITEM_INSTANT_MS`,
 * 1900..9999) so it can never collide with a real row.
 */
function primaryExpression(
  field: WorkItemSortField,
  dir: WorkItemSortDirection,
): SQL<PrimaryValue> {
  switch (field) {
    case "key":
      return sql<PrimaryValue>`${workItemTable.number}`;
    case "title":
      return sql<PrimaryValue>`${workItemTable.title}`;
    case "priority":
      return sql<PrimaryValue>`case ${workItemTable.priority}
        when 'urgent' then 4
        when 'high' then 3
        when 'medium' then 2
        when 'low' then 1
        else ${dir === "asc" ? 5 : -1}
      end`;
    case "dueDate": {
      const sentinel =
        dir === "asc"
          ? new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999))
          : new Date(Date.UTC(1900, 0, 1, 0, 0, 0, 0));
      return sql<PrimaryValue>`coalesce(${workItemTable.dueDate}, ${sentinel}::timestamp)`;
    }
  }
}

/** `ORDER BY <primary> <dir>, id ASC` -- `id` (cuid2, globally unique) is the stable
 * tie-break every field needs: `title`/`priority`/`dueDate` are not unique per row,
 * and even `number` (via `key`) is only unique per project, which this route already
 * is, but a plain `ORDER BY number` with no tie-break is still formally allowed to
 * reorder equal rows between calls under a concurrent write -- pinning `id` as a
 * second key removes that ambiguity outright, which is what makes cursor pagination
 * over ties correct (no duplicate or skipped row across a page boundary). */
export function workItemOrderBy(
  field: WorkItemSortField,
  dir: WorkItemSortDirection,
): SQL[] {
  const primary = primaryExpression(field, dir);
  return [
    dir === "asc" ? sql`${primary} asc` : sql`${primary} desc`,
    sql`${workItemTable.id} asc`,
  ];
}

type CursorPayload = {
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  v: PrimaryValue;
  id: string;
};

/** Opaque per `api-design.md` ("`?cursor=<opaque>`") -- base64url JSON. Not meant to be
 * decodable by a caller for any purpose other than round-tripping it back to this
 * route unmodified; nothing sensitive is encoded (the sort field/direction and the
 * boundary row's own sort value and id, all of which the caller already received in
 * the previous page's response body). */
export function encodeWorkItemCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Throws 400 (the project's standard plain-text error envelope, via `HTTPException`)
 * for anything that isn't a well-formed cursor for the CURRENT `sort`/`dir` -- a
 * cursor minted for a different sort field or direction cannot be continued
 * (its stored primary value has no meaning under a different order), so this is
 * rejected rather than silently reinterpreted, which could otherwise produce a
 * duplicate-or-gap page under a sort the caller never asked to continue. */
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

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sort" in parsed) ||
    !("dir" in parsed) ||
    !("v" in parsed) ||
    !("id" in parsed)
  ) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  const candidate = parsed as Record<string, unknown>;
  const { sort, dir, v, id } = candidate;

  if (
    (typeof v !== "string" && typeof v !== "number") ||
    typeof id !== "string" ||
    id.length === 0
  ) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  if (sort !== expected.sort || dir !== expected.dir) {
    throw new HTTPException(400, {
      message: "cursor: does not match the current sort/dir",
    });
  }

  return { sort: expected.sort, dir: expected.dir, v, id };
}

/** The keyset `WHERE` continuation clause: strictly past the boundary row in the
 * requested direction, on the SAME `(primary, id)` tuple `workItemOrderBy` orders by
 * -- this is what makes the walk gapless and duplicate-free across pages even while
 * rows are being concurrently inserted or updated elsewhere in the project (a
 * `LIMIT`/`OFFSET` page cannot make that guarantee; that is precisely why
 * `api-design.md` mandates cursor pagination for this surface). */
export function workItemCursorCondition(
  field: WorkItemSortField,
  dir: WorkItemSortDirection,
  cursor: CursorPayload,
): SQL {
  const primary = primaryExpression(field, dir);
  const op = dir === "asc" ? sql`>` : sql`<`;
  // `dueDate`'s primary expression is `timestamp`, but the cursor stores its value as
  // an ISO string (JSON has no date type) -- cast the bound parameter back to
  // `timestamp` so the row-comparison's two sides are the same type. The other three
  // fields' stored value is already the right primitive type (int for `key`/
  // `priority`, text for `title`), so no cast is needed there.
  const cursorPrimary =
    field === "dueDate" ? sql`(${cursor.v}::timestamp)` : sql`${cursor.v}`;
  return sql`(${primary}, ${workItemTable.id}) ${op} (${cursorPrimary}, ${cursor.id})`;
}

/** Builds the next cursor from the last row of the CURRENT page (before the
 * lookahead row, if any, is dropped) -- `row` must be the same shape `listWorkItems`
 * selects (`number`, `title`, `priorityRank`/`priority`, `dueDate` are all already
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
): PrimaryValue {
  switch (field) {
    case "key":
      return row.number;
    case "title":
      return row.title;
    case "priority": {
      const rank: Record<string, number> = {
        urgent: 4,
        high: 3,
        medium: 2,
        low: 1,
      };
      return row.priority ? (rank[row.priority] ?? 0) : dir === "asc" ? 5 : -1;
    }
    case "dueDate":
      return row.dueDate
        ? row.dueDate.toISOString()
        : dir === "asc"
          ? "9999-12-31T00:00:00.000Z"
          : "1900-01-01T00:00:00.000Z";
  }
}
