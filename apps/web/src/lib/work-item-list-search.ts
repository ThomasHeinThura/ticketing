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
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
export type WorkItemSortField =
  | (typeof WORK_ITEM_SORT_FIELDS)[number]
  | `cf.${string}`;

/**
 * The sort fields `POST /api/work-items/search` accepts (api-design.md, Work-item search v1).
 * `position` is the rank order of the list route and has no search equivalent.
 */
export const WORK_ITEM_SEARCH_SORT_FIELDS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
export type WorkItemSearchSortField =
  | (typeof WORK_ITEM_SEARCH_SORT_FIELDS)[number]
  | `cf.${string}`;

export type WorkItemSort = {
  field: WorkItemSortField;
  order: WorkItemSortDirection;
};

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
export type NativeWorkItemSearchColumn =
  (typeof WORK_ITEM_SEARCH_COLUMNS)[number];
export type WorkItemSearchColumn = NativeWorkItemSearchColumn | `cf.${string}`;

const CUSTOM_FIELD_COLUMN = /^cf\.[a-z][a-z0-9_]{0,63}$/u;

export function isWorkItemSearchColumn(
  value: unknown,
): value is WorkItemSearchColumn {
  return (
    typeof value === "string" &&
    ((WORK_ITEM_SEARCH_COLUMNS as readonly string[]).includes(value) ||
      CUSTOM_FIELD_COLUMN.test(value))
  );
}

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
    sorts?: WorkItemSort[];
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
    sorts?: WorkItemSort[];
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
    ((WORK_ITEM_SORT_FIELDS as readonly string[]).includes(value) ||
      /^cf\.[a-z][a-z0-9_]{0,63}$/u.test(value))
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
    ((WORK_ITEM_SEARCH_SORT_FIELDS as readonly string[]).includes(value) ||
      /^cf\.[a-z][a-z0-9_]{0,63}$/u.test(value))
  );
}

export function parseWorkItemSorts(raw: unknown): WorkItemSort[] | undefined {
  let candidate = raw;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.length > 5
  )
    return undefined;
  const result: WorkItemSort[] = [];
  const seen = new Set<string>();
  for (const entry of candidate) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return undefined;
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => !["field", "order"].includes(key)) ||
      !isWorkItemSearchSortField(item.field) ||
      !isWorkItemSortDirection(item.order) ||
      seen.has(item.field)
    )
      return undefined;
    seen.add(item.field);
    result.push({ field: item.field, order: item.order });
  }
  return result;
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
    columns.length > 100 ||
    new Set(columns).size !== columns.length ||
    !columns.every((column) => isWorkItemSearchColumn(column))
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
  const sorts = parseWorkItemSorts(candidate.sorts);
  return {
    ...parseWorkItemApprovalRequestSearch(candidate),
    ...parseWorkItemHierarchySearch(candidate),
    ...parseWorkItemRelationsSearch(candidate),
    ...parseWorkItemDetailSectionsSearch(candidate),
    ...(sorts
      ? { sorts, sort: sorts[0].field, dir: sorts[0].order }
      : {
          ...(isWorkItemSortField(candidate.sort)
            ? { sort: candidate.sort }
            : {}),
          ...(isWorkItemSortDirection(candidate.dir)
            ? { dir: candidate.dir }
            : {}),
        }),
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
  if (state.sorts?.length) query.set("sorts", JSON.stringify(state.sorts));
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
