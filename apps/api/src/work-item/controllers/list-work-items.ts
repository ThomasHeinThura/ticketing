import { and, eq, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import db from "../../database";
import {
  personTable,
  stateTable,
  stateTemplateTable,
  userTable,
  workItemTable,
  workspaceUserTable,
} from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import {
  DEFAULT_WORK_ITEM_LIST_LIMIT,
  decodeWorkItemCursor,
  encodeWorkItemCursor,
  primaryValueForCursor,
  type WorkItemSortDirection,
  type WorkItemSortField,
  workItemCursorCondition,
  workItemOrderBy,
} from "../list-query";
import type { ListWorkItemsQuery } from "../schema";

/**
 * #310: server-side sort, cursor pagination and filters for
 * `GET /api/projects/{projectId}/work-items`, plus state name/category and assignee
 * display-name resolution -- replacing #23's original unsorted, unfiltered,
 * unpaginated `findMany` (see this file's git history / that PR's own doc comment for
 * why pagination was explicitly deferred there rather than guessed at).
 *
 * Reach is UNCHANGED from #23: `getProjectWorkspaceId` still 404s a nonexistent or
 * soft-deleted project before anything else runs, and every row this query can ever
 * return is still scoped to the exact `(projectId, workspaceId)` pair the route's own
 * `workspaceAccess.fromProject` middleware already resolved and verified the caller's
 * membership against -- filters and sort only narrow or reorder WITHIN that same set,
 * they can never widen it. `archivedAt`/`deletedAt` exclusion (`WI-21`'s default-filter
 * convention) is unchanged too.
 *
 * No hidden field is reachable through sort or filter here: the four sortable fields
 * (`key`/`number`, `title`, `priority`, `dueDate`) and the state/assignee names this
 * route resolves are all fields the SAME caller already receives directly in the
 * response body -- there is no side channel (e.g. ordering leaking a value the caller
 * cannot otherwise read), and `sort`/sort-adjacent filters are validated against a
 * fixed allowlist (`schema.ts`'s `listWorkItemsQuery`), so a request naming any other
 * column is a 400, never silently accepted.
 *
 * Bounded queries, no N+1: exactly two queries run regardless of how many rows match --
 * one `SELECT ... LEFT/INNER JOIN ...` that resolves state name/category and assignee
 * name for the whole page in one round trip, and one `SELECT count(*)` for
 * `meta.total`. Neither cost scales with the number of ROWS returned per item.
 */

const WORK_ITEM_PRIORITY_COLUMN_VALUES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;

/**
 * Everything but the cursor: used both for the page query (with the cursor condition
 * appended) and, unchanged, for the `meta.total` count -- the total must reflect every
 * matching row regardless of pagination position, so it must never include the
 * cursor's own "strictly past this boundary" condition.
 */
async function buildFilterConditions(
  projectId: string,
  workspaceId: string,
  query: ListWorkItemsQuery,
  callerUserId: string,
): Promise<SQL[]> {
  const conditions: SQL[] = [
    eq(workItemTable.projectId, projectId),
    eq(workItemTable.workspaceId, workspaceId),
    isNull(workItemTable.archivedAt),
    isNull(workItemTable.deletedAt),
  ];

  if (query.state) {
    const ids = query.state.split(",").filter((id) => id.length > 0);
    if (ids.length > 0) {
      conditions.push(inArray(workItemTable.stateId, ids));
    }
  }

  if (query.priority) {
    const values = query.priority
      .split(",")
      .filter(
        (value): value is (typeof WORK_ITEM_PRIORITY_COLUMN_VALUES)[number] =>
          (WORK_ITEM_PRIORITY_COLUMN_VALUES as readonly string[]).includes(
            value,
          ),
      );
    if (values.length > 0) {
      conditions.push(inArray(workItemTable.priority, values));
    }
  }

  if (query.due_before) {
    // `listWorkItemsQuery` already validated this as a real calendar date
    // (`YYYY-MM-DD`) -- parsed as UTC midnight, matching every other date boundary in
    // this codebase (`schema.ts`'s `workItemDateTime`).
    conditions.push(
      lt(workItemTable.dueDate, new Date(`${query.due_before}T00:00:00.000Z`)),
    );
  }

  if (query.assignee) {
    if (query.assignee === "none") {
      conditions.push(isNull(workItemTable.assigneeId));
    } else if (query.assignee === "me") {
      // `work_item.assignee_id` references `person.id`, but the caller authenticates as
      // a `user` -- resolving "me" needs the one `person` row (if any) backed by this
      // `user_id`. No live route in this codebase assembles the full P3 identity model
      // yet (`index.ts`'s own file comment), so this is a narrow, local lookup, not a
      // dependency on that machinery. A caller with no `person` row at all (nothing
      // wires one up outside the P3 identity seed today) simply matches nothing --
      // `assignee=me` on an empty result is the correct, non-erroring answer, not a
      // bug: it can never widen the result (an always-false condition only narrows).
      const caller = await db.query.personTable.findFirst({
        where: eq(personTable.userId, callerUserId),
      });
      conditions.push(
        caller ? eq(workItemTable.assigneeId, caller.id) : sql`false`,
      );
    } else {
      conditions.push(eq(workItemTable.assigneeId, query.assignee));
    }
  }

  return conditions;
}

export async function listWorkItems(
  projectId: string,
  workspaceId: string,
  callerUserId: string,
  query: ListWorkItemsQuery,
) {
  await getProjectWorkspaceId(projectId);

  const sortField: WorkItemSortField = query.sort ?? "key";
  const dir: WorkItemSortDirection = query.dir ?? "asc";
  const limit = query.limit ?? DEFAULT_WORK_ITEM_LIST_LIMIT;

  const filterConditions = await buildFilterConditions(
    projectId,
    workspaceId,
    query,
    callerUserId,
  );

  const pageConditions = [...filterConditions];
  if (query.cursor) {
    const cursor = decodeWorkItemCursor(query.cursor, {
      sort: sortField,
      dir,
    });
    pageConditions.push(workItemCursorCondition(sortField, dir, cursor));
  }

  // `limit + 1`: the standard cursor-pagination lookahead -- fetching one extra row
  // tells us whether another page exists without a separate query, and that extra row
  // is dropped before the response is built.
  const rows = await db
    .select({
      workItem: workItemTable,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      assigneeName: userTable.name,
      // #320 security review, S3: signals whether the assignee's own user is
      // actually a member of THIS work item's workspace -- see the join comment
      // below for why this gates `assigneeName` rather than the join itself.
      assigneeIsWorkspaceMember: workspaceUserTable.id,
    })
    .from(workItemTable)
    // `work_item.state_id` is `NOT NULL` and `state.state_template_id` is `NOT NULL`
    // (`database/schema.ts`), so every work item has exactly one state and template --
    // an INNER JOIN can never drop a row here.
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    // `assignee_id`/`person.user_id` are both nullable (unassigned; or a placeholder
    // person with no linked login) -- LEFT JOIN so those rows still come back, with
    // `assigneeName: null`, rather than being silently dropped.
    .leftJoin(personTable, eq(workItemTable.assigneeId, personTable.id))
    .leftJoin(userTable, eq(personTable.userId, userTable.id))
    // #320 security review, S3: `work_item.assignee_id -> person.id` is a plain,
    // UNSCOPED foreign key (`schema.ts:1713`), unlike `state_id`/`type_id`/
    // `parent_id`, which are all composite-FK'd to the same workspace/project this
    // work item belongs to. Nothing in this codebase writes `assignee_id` today
    // (WI-10 assignment is unbuilt), so this is latent, not live -- but the review
    // proved live, with a direct SQL write, that a person in a completely different
    // organisation/workspace resolves and prints their real name here if that FK is
    // ever pointed there by a future write path. Rather than trust that every future
    // writer of `assignee_id` gets the roster check right, this route scopes the
    // NAME DISCLOSURE itself: `assigneeName` is only ever the resolved name when the
    // assignee's own user actually holds a `workspace_member` row in the SAME
    // workspace as this work item. A LEFT JOIN (not an inner join or a WHERE) so a
    // foreign assignment still returns the row -- with `assigneeName: null`, the
    // same shape an unresolvable name already has -- rather than hiding the work
    // item itself.
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workItemTable.workspaceId),
      ),
    )
    .where(and(...pageConditions))
    .orderBy(...workItemOrderBy(sortField, dir))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workItemTable)
    .where(and(...filterConditions));
  const total = totalRow?.total ?? 0;

  const lastRow = page.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? encodeWorkItemCursor({
          sort: sortField,
          dir,
          id: lastRow.workItem.id,
          ...primaryValueForCursor(sortField, lastRow.workItem, dir),
        })
      : null;

  return {
    data: page.map((row) => ({
      ...row.workItem,
      stateName: row.stateName,
      stateCategory: row.stateCategory,
      // Only ever the resolved name when the assignee is a member of THIS
      // workspace -- see the `workspaceUserTable` join's own comment above (#320
      // security review, S3).
      assigneeName: row.assigneeIsWorkspaceMember ? row.assigneeName : null,
    })),
    page: { nextCursor, hasMore },
    meta: { total },
  };
}

export default listWorkItems;
