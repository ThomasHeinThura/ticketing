export const WORK_ITEM_SORT_FIELDS = [
  "key",
  "title",
  "priority",
  "dueDate",
] as const;
export type WorkItemSortField = (typeof WORK_ITEM_SORT_FIELDS)[number];

export const WORK_ITEM_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type WorkItemSortDirection = (typeof WORK_ITEM_SORT_DIRECTIONS)[number];

export const WORK_ITEM_SEARCH_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
export type WorkItemSearchColumn = (typeof WORK_ITEM_SEARCH_COLUMNS)[number];
export type WorkItemFilterMode = "visual" | "text";

// The screen inventory names three `layout` values on this one route
// (`/agent/projects/{key}/work?layout=board|list|table`). Only `list` is built by this
// slice -- board and table are separate, not-yet-built P1 rows in
// `docs/02-design/screen-inventory.md`. `layout` is still parsed from the URL (not
// hardcoded) so a bookmark/link naming a future layout degrades to `list` today instead
// of 404ing, and starts working once that layout ships without changing the URL contract.
export const WORK_ITEM_LIST_LAYOUTS = ["list"] as const;
export type WorkItemListLayout = (typeof WORK_ITEM_LIST_LAYOUTS)[number];

export type WorkItemListSearch = {
  layout: WorkItemListLayout;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  filter?: string;
  filterMode?: WorkItemFilterMode;
  columns?: WorkItemSearchColumn[];
};

export function resolveWorkItemListSort(
  search: Pick<WorkItemListSearch, "sort" | "dir">,
) {
  const field = search.sort ?? "key";
  const order = search.dir ?? "asc";
  return {
    field,
    order,
    querySort:
      search.sort !== undefined || search.dir !== undefined
        ? [{ field, order }]
        : undefined,
  };
}

export const WORK_ITEM_FILTER_URL_MAX_LENGTH = 8192;

export const DEFAULT_WORK_ITEM_LIST_SEARCH: WorkItemListSearch = {
  layout: "list",
};

function isWorkItemSortField(value: unknown): value is WorkItemSortField {
  return (
    typeof value === "string" &&
    (WORK_ITEM_SORT_FIELDS as readonly string[]).includes(value)
  );
}

function isWorkItemSortDirection(
  value: unknown,
): value is WorkItemSortDirection {
  return (
    typeof value === "string" &&
    (WORK_ITEM_SORT_DIRECTIONS as readonly string[]).includes(value)
  );
}

function isWorkItemListLayout(value: unknown): value is WorkItemListLayout {
  return (
    typeof value === "string" &&
    (WORK_ITEM_LIST_LAYOUTS as readonly string[]).includes(value)
  );
}

/**
 * Parses a raw, possibly malformed search object (a hand-edited URL, an old bookmark, an
 * unset param) into a valid `WorkItemListSearch`, falling back to the default for any
 * missing or invalid field. Never throws -- this is also this route's `validateSearch`.
 */
export function parseWorkItemListSearch(raw: unknown): WorkItemListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  let columns: unknown = candidate.columns;
  if (typeof columns === "string") {
    try {
      columns = JSON.parse(columns) as unknown;
    } catch {
      columns = undefined;
    }
  }
  const validColumns =
    Array.isArray(columns) &&
    columns.length <= WORK_ITEM_SEARCH_COLUMNS.length &&
    columns.every(
      (column) =>
        typeof column === "string" &&
        (WORK_ITEM_SEARCH_COLUMNS as readonly string[]).includes(column),
    ) &&
    new Set(columns).size === columns.length;
  return {
    layout: isWorkItemListLayout(candidate.layout)
      ? candidate.layout
      : DEFAULT_WORK_ITEM_LIST_SEARCH.layout,
    ...(isWorkItemSortField(candidate.sort) ? { sort: candidate.sort } : {}),
    ...(isWorkItemSortDirection(candidate.dir) ? { dir: candidate.dir } : {}),
    ...(typeof candidate.filter === "string" &&
    candidate.filter.length > 0 &&
    candidate.filter.length <= WORK_ITEM_FILTER_URL_MAX_LENGTH &&
    ![...candidate.filter].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
      ? { filter: candidate.filter }
      : {}),
    ...(candidate.filterMode === "visual" || candidate.filterMode === "text"
      ? { filterMode: candidate.filterMode }
      : {}),
    ...(validColumns ? { columns: columns as WorkItemSearchColumn[] } : {}),
  };
}

/** The inverse direction, for a column-header sort toggle. */
export function toggleWorkItemSortDirection(
  dir: WorkItemSortDirection,
): WorkItemSortDirection {
  return dir === "asc" ? "desc" : "asc";
}
