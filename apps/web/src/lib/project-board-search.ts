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
export type ProjectCalendarSearch = ProjectViewSearch;

const SORT_FIELDS: readonly SortField[] = [
  "position",
  "createdAt",
  "priority",
  "dueDate",
  "title",
  "number",
];
const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];
const FILTER_KEYS = [
  "status",
  "priority",
  "assignee",
  "dueDate",
  "labels",
] as const;
const SCALAR_KEYS = ["taskId", "month", "q", "sort", "dir"] as const;
function parseStringList(
  value: unknown,
  dueDate = false,
): string[] | undefined {
  const values = new Set<string>();
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (
      typeof entry === "string" &&
      entry &&
      (!dueDate || Object.hasOwn(DUE_DATE_FILTER_VALUES, entry))
    )
      values.add(entry);
  }
  return values.size ? [...values] : undefined;
}

export function parseProjectViewSearch(
  raw: unknown,
  calendar = false,
): ProjectViewSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const search: ProjectViewSearch = {};
  for (const key of SCALAR_KEYS) {
    const value = candidate[key];
    if (
      typeof value === "string" &&
      value &&
      (key !== "sort" || SORT_FIELDS.includes(value as SortField)) &&
      (key !== "dir" || SORT_DIRECTIONS.includes(value as SortDirection)) &&
      (!calendar || key !== "month" || parseMonth(value))
    )
      search[key] = value as never;
  }
  if (candidate.layout === "board" || candidate.layout === "list")
    search.layout = candidate.layout;
  for (const key of FILTER_KEYS) {
    const values = parseStringList(candidate[key], key === "dueDate");
    if (values) search[key] = values;
  }
  return search;
}

export function parseMonth(value: unknown): value is string {
  return (
    typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/u.test(value)
  );
}

export function parseProjectCalendarSearch(
  raw: unknown,
): ProjectCalendarSearch {
  return parseProjectViewSearch(raw, true);
}

export function parseProjectViewSearchFromParams(
  params: URLSearchParams,
  parseSearch = parseProjectViewSearch,
): ProjectViewSearch {
  const search: Record<string, unknown> = {};
  params.forEach((value, key) => {
    if ((FILTER_KEYS as readonly string[]).includes(key)) {
      const current = search[key];
      if (Array.isArray(current)) current.push(value);
      else search[key] = [value];
    } else search[key] = value;
  });
  return parseSearch(search);
}

export function appendProjectViewSearchParams(
  params: URLSearchParams,
  raw: unknown,
  parseSearch = parseProjectViewSearch,
) {
  const search = parseSearch(raw);
  for (const [key, value] of Object.entries({
    layout: search.layout,
    ...search,
  })) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value) params.set(key, value);
  }
}

export function parseProjectBoardSearch(raw: unknown) {
  return parseProjectViewSearch(raw) satisfies ProjectBoardSearch;
}

export function parseProjectBacklogSearch(raw: unknown) {
  return parseProjectViewSearch(raw) satisfies ProjectBacklogSearch;
}
