import {
  type BoardFilters,
  type ProjectBoardLayout,
  type ProjectViewSearch,
  parseProjectViewSearch,
} from "./project-board-search";
import type { SortConfig } from "./sort-tasks";

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
