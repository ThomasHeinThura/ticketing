import {
  parseWorkItemApprovalRequestSearch,
  type WorkItemApprovalRequestSearch,
} from "./work-item-approval-request-search";
import {
  parseWorkItemDetailSectionsSearch,
  type WorkItemDetailSectionsSearch,
} from "./work-item-detail-sections-search";
import {
  parseWorkItemHierarchySearch,
  type WorkItemHierarchySearch,
} from "./work-item-hierarchy-search";
import {
  parseWorkItemRelationsSearch,
  type WorkItemRelationsSearch,
} from "./work-item-relations-search";
// URL state for the work-item list route (`/agent/projects/{key}/work`). Kept in its own
// module so the saved-view screens reuse exactly the same parsing and bounds for the shared
// query properties (filter text, editor mode, sort, columns) without importing route code.
//
// Every value here is validated, bounded and total: a hand-edited URL, an old bookmark or a
// shared link can never throw, and unknown values fall back rather than 404 (AGENTS.md rule 4).

export const WORK_ITEM_SORT_FIELDS = [
  "key",
  "position",
  "title",
  "priority",
  "dueDate",
] as const;
export type WorkItemSortField = (typeof WORK_ITEM_SORT_FIELDS)[number];

/**
 * The sort fields `POST /api/work-items/search` accepts (api-design.md, Work-item search v1).
 * `position` is the rank order of the list route and has no search equivalent.
 */
export const WORK_ITEM_SEARCH_SORT_FIELDS = [
  "key",
  "title",
  "priority",
  "dueDate",
] as const;
export type WorkItemSearchSortField =
  (typeof WORK_ITEM_SEARCH_SORT_FIELDS)[number];

export const WORK_ITEM_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type WorkItemSortDirection = (typeof WORK_ITEM_SORT_DIRECTIONS)[number];

/** `columns` is a duplicate-free subset of these, in display order (api-design.md). */
export const WORK_ITEM_SEARCH_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
export type WorkItemSearchColumn = (typeof WORK_ITEM_SEARCH_COLUMNS)[number];

/** Which rendering of the one filter AST the editor shows (`SV-11`). */
export type WorkItemFilterMode = "visual" | "text";

/** The longest filter text the URL carries; the editor input enforces the same bound. */
export const WORK_ITEM_FILTER_URL_MAX_LENGTH = 8192;

// The screen inventory names three `layout` values on this one route
// (`/agent/projects/{key}/work?layout=board|list|table`).
export const WORK_ITEM_LIST_LAYOUTS = ["list", "board", "table"] as const;
export type WorkItemListLayout = (typeof WORK_ITEM_LIST_LAYOUTS)[number];

/** The query properties a work-item search shares with a saved view. Each is optional. */
export type WorkItemQueryState = WorkItemApprovalRequestSearch &
  WorkItemHierarchySearch &
  WorkItemRelationsSearch &
  WorkItemDetailSectionsSearch & {
    sort?: WorkItemSortField;
    dir?: WorkItemSortDirection;
    filter?: string;
    filterMode?: WorkItemFilterMode;
    columns?: WorkItemSearchColumn[];
    /** Addressable side-pane selection (`VW-4`, `?item={key}`). */
    item?: string;
  };

export type WorkItemListSearch = WorkItemApprovalRequestSearch &
  WorkItemHierarchySearch &
  WorkItemRelationsSearch &
  WorkItemDetailSectionsSearch & {
    layout: WorkItemListLayout;
    sort: WorkItemSortField;
    dir: WorkItemSortDirection;
    filter?: string;
    filterMode?: WorkItemFilterMode;
    columns?: WorkItemSearchColumn[];
    /** Addressable side-pane selection (`VW-4`, `?item={key}`). */
    item?: string;
  };

export const DEFAULT_WORK_ITEM_LIST_SEARCH: Pick<
  WorkItemListSearch,
  "layout" | "sort" | "dir"
> = {
  layout: "list",
  sort: "key",
  dir: "asc",
};

const WORK_ITEM_KEY_PATTERN = /^[A-Z][A-Z0-9]*-[1-9]\d*$/u;

export function isValidWorkItemKeyParam(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    WORK_ITEM_KEY_PATTERN.test(value)
  );
}

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

export function isWorkItemSearchSortField(
  value: unknown,
): value is WorkItemSearchSortField {
  return (
    typeof value === "string" &&
    (WORK_ITEM_SEARCH_SORT_FIELDS as readonly string[]).includes(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function parseColumns(raw: unknown): WorkItemSearchColumn[] | undefined {
  let columns: unknown = raw;
  if (typeof columns === "string") {
    try {
      columns = JSON.parse(columns) as unknown;
    } catch {
      return undefined;
    }
  }
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > WORK_ITEM_SEARCH_COLUMNS.length ||
    new Set(columns).size !== columns.length ||
    !columns.every(
      (column) =>
        typeof column === "string" &&
        (WORK_ITEM_SEARCH_COLUMNS as readonly string[]).includes(column),
    )
  )
    return undefined;
  return columns as WorkItemSearchColumn[];
}

/**
 * Parses the optional query properties out of a raw search object. Absent or invalid
 * properties are simply omitted -- no default is ever added -- so a saved view that stored
 * no sort or columns is not given one by opening and re-saving it (`SV-11`, `SV-14`).
 */
export function parseWorkItemQueryState(raw: unknown): WorkItemQueryState {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const columns = parseColumns(candidate.columns);
  return {
    ...parseWorkItemApprovalRequestSearch(candidate),
    ...parseWorkItemHierarchySearch(candidate),
    ...parseWorkItemRelationsSearch(candidate),
    ...parseWorkItemDetailSectionsSearch(candidate),
    ...(isWorkItemSortField(candidate.sort) ? { sort: candidate.sort } : {}),
    ...(isWorkItemSortDirection(candidate.dir) ? { dir: candidate.dir } : {}),
    ...(typeof candidate.filter === "string" &&
    candidate.filter.length > 0 &&
    candidate.filter.length <= WORK_ITEM_FILTER_URL_MAX_LENGTH &&
    !hasControlCharacter(candidate.filter)
      ? { filter: candidate.filter }
      : {}),
    ...(candidate.filterMode === "visual" || candidate.filterMode === "text"
      ? { filterMode: candidate.filterMode }
      : {}),
    ...(columns ? { columns } : {}),
    ...(isValidWorkItemKeyParam(candidate.item)
      ? { item: candidate.item }
      : {}),
  };
}

/**
 * Parses a raw, possibly malformed search object (a hand-edited URL, an old bookmark, an
 * unset param) into a valid `WorkItemListSearch`, falling back to the default for any
 * missing or invalid field. Never throws -- this is also this route's `validateSearch`.
 */
export function parseWorkItemListSearch(raw: unknown): WorkItemListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const { sort, dir, ...rest } = parseWorkItemQueryState(candidate);
  return {
    layout: isWorkItemListLayout(candidate.layout)
      ? candidate.layout
      : DEFAULT_WORK_ITEM_LIST_SEARCH.layout,
    sort: sort ?? DEFAULT_WORK_ITEM_LIST_SEARCH.sort,
    dir: dir ?? DEFAULT_WORK_ITEM_LIST_SEARCH.dir,
    ...rest,
  };
}

/** The query-string form of the optional properties, for `routes.*.build`. */
export function appendWorkItemQueryState(
  query: URLSearchParams,
  state: WorkItemQueryState,
) {
  if (state.sort) query.set("sort", state.sort);
  if (state.dir) query.set("dir", state.dir);
  if (state.filter) query.set("filter", state.filter);
  if (state.filterMode) query.set("filterMode", state.filterMode);
  if (state.columns) query.set("columns", JSON.stringify(state.columns));
  if (state.item) query.set("item", state.item);
  if (state.sections) query.set("sections", JSON.stringify(state.sections));
  if (state.hierarchy) query.set("hierarchy", JSON.stringify(state.hierarchy));
  if (state.relations) query.set("relations", JSON.stringify(state.relations));
  if (state.approvalRequest)
    query.set("approvalRequest", JSON.stringify(state.approvalRequest));
}

/** The inverse direction, for a column-header sort toggle. */
export function toggleWorkItemSortDirection(
  dir: WorkItemSortDirection,
): WorkItemSortDirection {
  return dir === "asc" ? "desc" : "asc";
}
