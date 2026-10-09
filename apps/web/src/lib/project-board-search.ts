import type { SortDirection, SortField } from "./sort-tasks";

export type ProjectBoardLayout = "board" | "list";

export type ProjectViewFilters = {
  status?: string[];
  priority?: string[];
  assignee?: string[];
  dueDate?: string[];
  labels?: string[];
};

export type BoardFilters = {
  status: string[] | null;
  priority: string[] | null;
  assignee: string[] | null;
  dueDate: string[] | null;
  labels: string[] | null;
};

export const DUE_DATE_FILTER_VALUES = {
  dueNextWeek: "dueNextWeek",
  dueThisWeek: "dueThisWeek",
  noDueDate: "noDueDate",
} as const;

export type ProjectViewSearch = ProjectViewFilters & {
  taskId?: string;
  layout?: ProjectBoardLayout;
  month?: string;
  q?: string;
  sort?: SortField;
  dir?: SortDirection;
};

export type ProjectBoardSearch = ProjectViewSearch;
export type ProjectBacklogSearch = ProjectViewSearch;

const SORT_FIELDS: readonly SortField[] = [
  "position",
  "createdAt",
  "priority",
  "dueDate",
  "title",
  "number",
];
const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];
const DUE_DATE_FILTERS = Object.values(DUE_DATE_FILTER_VALUES);
const FILTER_KEYS = [
  "status",
  "priority",
  "assignee",
  "dueDate",
  "labels",
] as const;
const SCALAR_KEYS = ["taskId", "month", "q", "sort", "dir"] as const;

function parseStringList(value: unknown): string[] | undefined {
  const entries = Array.isArray(value) ? value : [value];
  const values = entries.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique : undefined;
}

export function parseProjectViewSearch(raw: unknown): ProjectViewSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const search: ProjectViewSearch = {};
  for (const key of SCALAR_KEYS) {
    const value = candidate[key];
    if (
      typeof value === "string" &&
      value.length > 0 &&
      (key !== "sort" || SORT_FIELDS.includes(value as SortField)) &&
      (key !== "dir" || SORT_DIRECTIONS.includes(value as SortDirection))
    )
      search[key] = value as never;
  }
  if (candidate.layout === "board" || candidate.layout === "list")
    search.layout = candidate.layout;
  for (const key of FILTER_KEYS) {
    let values = parseStringList(candidate[key]);
    if (key === "dueDate")
      values = values?.filter((value) =>
        (DUE_DATE_FILTERS as readonly string[]).includes(value),
      );
    if (values?.length) search[key] = values;
  }
  return search;
}

export function parseProjectViewSearchFromParams(
  params: URLSearchParams,
): ProjectViewSearch {
  const search: Record<string, unknown> = Object.fromEntries(params);
  for (const key of FILTER_KEYS) search[key] = params.getAll(key);
  return parseProjectViewSearch(search);
}

export function appendProjectViewSearchParams(
  params: URLSearchParams,
  raw: unknown,
) {
  const search = parseProjectViewSearch(raw);
  if (search.layout) params.set("layout", search.layout);
  for (const key of SCALAR_KEYS) {
    const value = search[key];
    if (value) params.set(key, value);
  }
  for (const key of FILTER_KEYS) {
    for (const value of search[key] ?? []) params.append(key, value);
  }
}

export function parseProjectBoardSearch(raw: unknown) {
  return parseProjectViewSearch(raw) satisfies ProjectBoardSearch;
}

export function parseProjectBacklogSearch(raw: unknown) {
  return parseProjectViewSearch(raw) satisfies ProjectBacklogSearch;
}
