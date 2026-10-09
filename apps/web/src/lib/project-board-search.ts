import type { SortConfig, SortDirection, SortField } from "./sort-tasks";

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
  const dueDate = parseStringList(candidate.dueDate)?.filter((value) =>
    (DUE_DATE_FILTERS as readonly string[]).includes(value),
  );
  const filters: ProjectViewFilters = {};
  for (const key of FILTER_KEYS) {
    const values =
      key === "dueDate" ? dueDate : parseStringList(candidate[key]);
    if (values?.length) filters[key] = values;
  }

  return {
    ...(typeof candidate.taskId === "string" && candidate.taskId.length > 0
      ? { taskId: candidate.taskId }
      : {}),
    ...(candidate.layout === "board" || candidate.layout === "list"
      ? { layout: candidate.layout }
      : {}),
    ...(typeof candidate.month === "string" && candidate.month.length > 0
      ? { month: candidate.month }
      : {}),
    ...(typeof candidate.q === "string" && candidate.q.length > 0
      ? { q: candidate.q }
      : {}),
    ...(typeof candidate.sort === "string" &&
    SORT_FIELDS.includes(candidate.sort as SortField)
      ? { sort: candidate.sort as SortField }
      : {}),
    ...(typeof candidate.dir === "string" &&
    SORT_DIRECTIONS.includes(candidate.dir as SortDirection)
      ? { dir: candidate.dir as SortDirection }
      : {}),
    ...filters,
  };
}

export function parseProjectViewSearchFromParams(
  params: URLSearchParams,
): ProjectViewSearch {
  return parseProjectViewSearch({
    taskId: params.get("taskId"),
    layout: params.get("layout"),
    month: params.get("month"),
    q: params.get("q"),
    sort: params.get("sort"),
    dir: params.get("dir"),
    status: params.getAll("status"),
    priority: params.getAll("priority"),
    assignee: params.getAll("assignee"),
    dueDate: params.getAll("dueDate"),
    labels: params.getAll("labels"),
  });
}

export function appendProjectViewSearchParams(
  params: URLSearchParams,
  raw: unknown,
) {
  const search = parseProjectViewSearch(raw);
  if (search.layout) params.set("layout", search.layout);
  if (search.taskId) params.set("taskId", search.taskId);
  if (search.month) params.set("month", search.month);
  if (search.q) params.set("q", search.q);
  if (search.sort) params.set("sort", search.sort);
  if (search.dir) params.set("dir", search.dir);
  for (const key of FILTER_KEYS) {
    for (const value of search[key] ?? []) params.append(key, value);
  }
}

export function projectViewFiltersFromSearch(
  search: ProjectViewSearch,
): BoardFilters {
  return {
    status: search.status ?? [],
    priority: search.priority ?? [],
    assignee: search.assignee ?? [],
    dueDate: search.dueDate ?? [],
    labels: search.labels ?? [],
  };
}

export function projectViewSortFromSearch(
  search: ProjectViewSearch,
): SortConfig {
  return {
    field: search.sort ?? "position",
    direction: search.dir ?? "asc",
  };
}

export function withProjectViewState(
  current: ProjectViewSearch,
  patch: Partial<ProjectViewSearch>,
): ProjectViewSearch {
  return parseProjectViewSearch({ ...current, ...patch });
}

export function withProjectBoardLayout(
  search: ProjectViewSearch,
  layout: ProjectBoardLayout,
): ProjectViewSearch {
  return withProjectViewState(search, { layout });
}

export function withProjectBoardTask(
  search: ProjectViewSearch,
  taskId: string | undefined,
): ProjectViewSearch {
  return withProjectViewState(search, { taskId });
}

export function withProjectViewFilters(
  search: ProjectViewSearch,
  filters: BoardFilters,
): ProjectViewSearch {
  return withProjectViewState(search, {
    status: filters.status ?? undefined,
    priority: filters.priority ?? undefined,
    assignee: filters.assignee ?? undefined,
    dueDate: filters.dueDate ?? undefined,
    labels: filters.labels ?? undefined,
  });
}

export function withProjectViewSort(
  search: ProjectViewSearch,
  sort: SortConfig,
): ProjectViewSearch {
  return withProjectViewState(search, {
    sort: sort.field,
    dir: sort.direction,
  });
}

export function resolveProjectBoardLayout(
  urlLayout: ProjectBoardLayout | undefined,
  preferredLayout: ProjectBoardLayout,
): ProjectBoardLayout {
  return urlLayout ?? preferredLayout;
}

export function parseProjectBoardSearch(raw: unknown) {
  return parseProjectViewSearch(raw) satisfies ProjectBoardSearch;
}

export function parseProjectBacklogSearch(raw: unknown) {
  return parseProjectViewSearch(raw) satisfies ProjectBacklogSearch;
}
