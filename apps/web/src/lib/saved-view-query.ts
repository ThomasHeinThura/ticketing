import type { SavedViewUrlSearch } from "./routes";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
  type WorkItemFilter,
} from "./work-item-filter";
import {
  isWorkItemSearchSortField,
  WORK_ITEM_SEARCH_COLUMNS,
  type WorkItemSearchColumn,
  type WorkItemSearchSortField,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "./work-item-list-search";

/**
 * The saved-view side of `SV-14` / `SV-19`: a saved view stores one query document
 * (`{ entity, filter, sort, groupBy, columns, aggregate }`) plus a layout, and its URL carries
 * the same definition as plain search parameters so a link fully encodes it. These pure
 * functions are the two-way translation, and they never add a default: a view that stored no
 * sort or columns is not given one by being opened, run, cloned or re-saved.
 *
 * The stored envelope names a sort entry `{ field, direction }`; the work-item search endpoint
 * names the same thing `{ field, order }`. That difference lives here and nowhere else.
 */

export const SAVED_VIEW_LAYOUTS = [
  "board",
  "list",
  "table",
  "calendar",
  "timeline",
  "chart",
] as const;
export type SavedViewLayout = (typeof SAVED_VIEW_LAYOUTS)[number];

export function isSavedViewLayout(value: unknown): value is SavedViewLayout {
  return (
    typeof value === "string" &&
    (SAVED_VIEW_LAYOUTS as readonly string[]).includes(value)
  );
}

const SUPPORTED_QUERY_KEYS = new Set([
  "entity",
  "filter",
  "sort",
  "groupBy",
  "columns",
  "aggregate",
]);

const COLUMNS = new Set<string>(WORK_ITEM_SEARCH_COLUMNS);

/** The minimum of a saved view these helpers read (the API's `SavedView`). */
export type SavedViewDefinition = {
  workspaceId: string;
  scope: string;
  scopeId: string;
  layout: string;
  query: unknown;
};

/** A saved-view screen may execute only properties its URL and runner preserve. */
export function isExecutableSavedViewQuery(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const query = value as Record<string, unknown>;
  if (
    Object.keys(query).some((key) => !SUPPORTED_QUERY_KEYS.has(key)) ||
    (query.entity !== undefined && query.entity !== "work_item") ||
    query.groupBy !== undefined ||
    query.aggregate !== undefined
  ) {
    return false;
  }

  if (
    query.sort !== undefined &&
    (!Array.isArray(query.sort) ||
      query.sort.length > 1 ||
      query.sort.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          Object.keys(item).some(
            (key) => !["field", "direction"].includes(key),
          ) ||
          !isWorkItemSearchSortField((item as Record<string, unknown>).field) ||
          !["asc", "desc"].includes(
            String((item as Record<string, unknown>).direction),
          ),
      ))
  ) {
    return false;
  }
  if (
    query.columns !== undefined &&
    (!Array.isArray(query.columns) ||
      query.columns.length === 0 ||
      query.columns.some((column) => !COLUMNS.has(String(column))) ||
      new Set(query.columns).size !== query.columns.length)
  ) {
    return false;
  }
  if (query.filter !== undefined) {
    if (
      !query.filter ||
      typeof query.filter !== "object" ||
      Array.isArray(query.filter)
    )
      return false;
    try {
      printWorkItemFilterText(query.filter as WorkItemFilter);
    } catch {
      return false;
    }
  }
  return true;
}

export function cloneSavedViewName(name: string): string {
  const suffix = " copy";
  return `${name.slice(0, 200 - suffix.length).trimEnd()}${suffix}`;
}

/**
 * Whether a URL's workspace, scope and layout are the saved view's own. A complete URL that
 * disagrees would run another workspace's or project's query under this view's name, so the
 * screen replaces it with the stored definition. An incomplete URL has nothing to disagree.
 */
export function savedViewUrlContextMatches(
  view: {
    workspaceId?: string;
    scope?: string;
    scopeId?: string;
    layout?: string;
  },
  search: {
    workspaceId?: string;
    scope?: string;
    scopeId?: string;
    layout?: string;
  },
  snapshotComplete: boolean,
): boolean {
  return (
    !snapshotComplete ||
    (search.workspaceId === view.workspaceId &&
      search.scope === view.scope &&
      search.scopeId === view.scopeId &&
      search.layout === view.layout)
  );
}

/** A URL is a complete encoding of a view only when it names all four context parts. */
export function isSavedViewSnapshotComplete(search: {
  workspaceId?: string;
  scope?: string;
  scopeId?: string;
  layout?: string;
}): boolean {
  return Boolean(
    search.workspaceId && search.scope && search.scopeId && search.layout,
  );
}

/**
 * The sort a URL asks for, or none. A sort field alone means ascending and a direction alone
 * means by key, so a partial URL has exactly one reading; neither means no sort at all.
 */
export function savedViewSort(
  search: Pick<SavedViewUrlSearch, "sort" | "dir">,
):
  | { field: WorkItemSearchSortField; order: WorkItemSortDirection }
  | undefined {
  if (search.sort === undefined && search.dir === undefined) return undefined;
  const field: WorkItemSortField = search.sort ?? "key";
  if (!isWorkItemSearchSortField(field)) return undefined;
  return { field, order: search.dir ?? "asc" };
}

function printStoredFilter(filter: unknown): string | undefined {
  if (filter === undefined) return undefined;
  try {
    const text = printWorkItemFilterText(filter as WorkItemFilter);
    return text || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A saved view's own definition as URL search parameters. Only what the view stored appears;
 * the filter AST is shown in its canonical text rendering (`SV-11`).
 */
export function savedViewStoredSearch(
  view: SavedViewDefinition,
): SavedViewUrlSearch {
  const query =
    view.query && typeof view.query === "object" && !Array.isArray(view.query)
      ? (view.query as Record<string, unknown>)
      : {};
  const sort = Array.isArray(query.sort)
    ? (query.sort[0] as Record<string, unknown> | undefined)
    : undefined;
  const filter = printStoredFilter(query.filter);
  const columns =
    Array.isArray(query.columns) &&
    query.columns.length > 0 &&
    query.columns.every(
      (item): item is WorkItemSearchColumn =>
        typeof item === "string" && COLUMNS.has(item),
    )
      ? query.columns
      : undefined;
  return {
    workspaceId: view.workspaceId,
    scope: view.scope === "project" ? "project" : "workspace",
    scopeId: view.scopeId,
    layout: view.layout,
    ...(filter ? { filter } : {}),
    ...(sort && isWorkItemSearchSortField(sort.field)
      ? {
          sort: sort.field,
          dir: sort.direction === "desc" ? ("desc" as const) : ("asc" as const),
        }
      : {}),
    ...(columns ? { columns } : {}),
  };
}

/**
 * The query document a URL's definition stores: the same envelope the API validates. Filter
 * text is parsed here, so unparseable text throws rather than being stored.
 */
export function savedViewQueryDocument(
  search: Pick<SavedViewUrlSearch, "filter" | "sort" | "dir" | "columns">,
): Record<string, unknown> {
  const filter = search.filter
    ? parseWorkItemFilterText(search.filter)
    : undefined;
  const sort = savedViewSort(search);
  return {
    entity: "work_item",
    ...(filter ? { filter } : {}),
    ...(sort ? { sort: [{ field: sort.field, direction: sort.order }] } : {}),
    ...(search.columns ? { columns: search.columns } : {}),
  };
}

function canonicalFilter(text: string | undefined): string | undefined {
  if (!text) return undefined;
  try {
    return printWorkItemFilterText(parseWorkItemFilterText(text)) || undefined;
  } catch {
    // Unparseable text never equals a stored definition.
    return `\u0000${text}`;
  }
}

/**
 * Whether a URL's definition is exactly what the view stored, so the server can run the
 * stored view itself (`POST /api/views/{id}/run`, `GET .../count`). Anything else -- an edit
 * in progress, a hand-changed link -- is run as a direct search with the same validator and
 * the same reach, so it can never show more than the viewer may see.
 */
export function savedViewDefinitionMatches(
  view: SavedViewDefinition,
  search: SavedViewUrlSearch,
): boolean {
  const stored = savedViewStoredSearch(view);
  const storedSort = savedViewSort(stored);
  const urlSort = savedViewSort(search);
  return (
    stored.workspaceId === search.workspaceId &&
    stored.scope === search.scope &&
    stored.scopeId === search.scopeId &&
    stored.layout === search.layout &&
    canonicalFilter(stored.filter) === canonicalFilter(search.filter) &&
    JSON.stringify(storedSort ?? null) === JSON.stringify(urlSort ?? null) &&
    JSON.stringify(stored.columns ?? null) ===
      JSON.stringify(search.columns ?? null)
  );
}
