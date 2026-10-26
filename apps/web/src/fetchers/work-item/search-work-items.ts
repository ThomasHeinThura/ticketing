import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import {
  isWorkItemSearchSortField,
  type WorkItemSearchColumn,
  type WorkItemSearchSortField,
  type WorkItemSort,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import {
  parseWorkItemFilterText,
  type WorkItemFilter,
} from "@/lib/work-item-filter";
import type {
  WorkItemCustomFieldColumn,
  WorkItemCustomFieldPerson,
} from "@/types/work-item";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

export type StructuredWorkItemsResult = {
  items: WorkItemRow[];
  hasPartialFailure: boolean;
  hasMore: boolean;
  nextCursor?: string | null;
  /** `meta.total`: the exact count of reachable matches, not just this page. */
  total?: number;
  customFieldColumns?: WorkItemCustomFieldColumn[];
  customFieldPeople?: WorkItemCustomFieldPerson[];
};

/**
 * The sort the search endpoint accepts for the list's current sort. `position` is the list
 * route's rank order and is not a search sort, so it is not forwarded (the endpoint then
 * defaults to `key asc`).
 */
export function toSearchSort(
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
): WorkItemSearchSort[] {
  return isWorkItemSearchSortField(sort) ? [{ field: sort, order: dir }] : [];
}

export type WorkItemSearchSort = {
  field: WorkItemSearchSortField;
  order: "asc" | "desc";
};

export function toSearchSorts(
  sorts: readonly WorkItemSort[] | undefined,
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
): WorkItemSearchSort[] {
  return (sorts?.length ? sorts : [{ field: sort, order: dir }]).flatMap(
    (entry) =>
      isWorkItemSearchSortField(entry.field)
        ? [{ field: entry.field, order: entry.order }]
        : [],
  );
}

/**
 * `POST /api/work-items/search` with an already-built filter AST. The saved-view screens and
 * the work list share this one boundary: it validates every row, keeps the server's refusal
 * detail, and sends only what the caller chose -- an absent `sort` or `columns` is omitted,
 * never defaulted, so a stored query document is not rewritten by being run.
 */
export async function postWorkItemSearch(input: {
  workspaceId: string;
  filter?: WorkItemFilter;
  sort?: WorkItemSearchSort[];
  columns?: WorkItemSearchColumn[];
  cursor?: string;
}): Promise<StructuredWorkItemsResult> {
  const response = await client["work-items"].search.$post({
    json: {
      workspaceId: input.workspaceId,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      query: {
        entity: "work_item",
        ...(input.filter ? { filter: input.filter } : {}),
        ...(input.sort && input.sort.length > 0 ? { sort: input.sort } : {}),
        ...(input.columns ? { columns: input.columns } : {}),
      },
    },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to search work items"),
    );
  }
  const { data, page, meta, customFieldColumns, customFieldPeople } =
    await response.json();
  const items = data.map(parseWorkItemRow);
  return {
    items,
    hasPartialFailure: items.some((item) => item.unavailableFields.length > 0),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    total: meta?.total,
    ...(customFieldColumns ? { customFieldColumns } : {}),
    ...(customFieldPeople ? { customFieldPeople } : {}),
  };
}

/** Parses filter text from a URL, failing as a 400 the user can fix; it is never sent. */
export function parseFilterTextOrThrow(
  text: string,
): WorkItemFilter | undefined {
  try {
    return parseWorkItemFilterText(text);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid filter text.",
    );
  }
}

/**
 * The work list's read: the list's project becomes a leading `project` clause (the endpoint's
 * own scope is the workspace and the actor's reach, never the page the user is on), with the
 * list's sort and the chosen columns.
 */
export default async function searchWorkItems(input: {
  workspaceId: string;
  projectSlug: string;
  filter: string;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  sorts?: WorkItemSort[];
  columns?: WorkItemSearchColumn[];
  /** The `page.nextCursor` of the previous page; bound by the server to this exact query. */
  cursor?: string;
}): Promise<StructuredWorkItemsResult> {
  const filter = parseFilterTextOrThrow(input.filter);
  const projectFilter = {
    field: "project",
    op: "eq",
    value: input.projectSlug,
  } as const;
  return postWorkItemSearch({
    workspaceId: input.workspaceId,
    filter: filter
      ? { op: "and", clauses: [projectFilter, filter] }
      : projectFilter,
    sort: toSearchSorts(input.sorts, input.sort, input.dir),
    columns: input.columns,
    cursor: input.cursor,
  });
}
