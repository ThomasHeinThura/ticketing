import { printWorkItemFilterText } from "./work-item-filter";

const SUPPORTED_QUERY_KEYS = new Set([
  "entity",
  "filter",
  "sort",
  "groupBy",
  "columns",
  "aggregate",
]);
const SORT_FIELDS = new Set(["key", "title", "priority", "dueDate"]);
const COLUMNS = new Set([
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
]);

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
          !SORT_FIELDS.has(String((item as Record<string, unknown>).field)) ||
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
    if (!query.filter || typeof query.filter !== "object") return false;
    try {
      printWorkItemFilterText(
        query.filter as Parameters<typeof printWorkItemFilterText>[0],
      );
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

export function savedViewUrlContextMatches(
  view: {
    workspaceId: string;
    scope: string;
    scopeId: string;
    layout: string;
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
