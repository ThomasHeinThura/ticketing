export type ProjectBoardLayout = "board" | "list";

export type ProjectBoardSearch = {
  taskId?: string;
  layout?: ProjectBoardLayout;
};

export type ProjectBacklogSearch = { taskId?: string };

export function resolveProjectBoardLayout(
  urlLayout: ProjectBoardLayout | undefined,
  preferredLayout: ProjectBoardLayout,
): ProjectBoardLayout {
  return urlLayout ?? preferredLayout;
}

export function parseProjectBoardSearch(raw: Record<string, unknown>) {
  return {
    ...(typeof raw.taskId === "string" && raw.taskId.length > 0
      ? { taskId: raw.taskId }
      : {}),
    ...(raw.layout === "board" || raw.layout === "list"
      ? { layout: raw.layout }
      : {}),
  } satisfies ProjectBoardSearch;
}

export function parseProjectBacklogSearch(raw: Record<string, unknown>) {
  return {
    ...(typeof raw.taskId === "string" && raw.taskId.length > 0
      ? { taskId: raw.taskId }
      : {}),
  } satisfies ProjectBacklogSearch;
}

export function withProjectBoardLayout(
  search: ProjectBoardSearch,
  layout: ProjectBoardLayout,
): ProjectBoardSearch {
  return { ...search, layout };
}

export function withProjectBoardTask(
  search: ProjectBoardSearch,
  taskId: string | undefined,
): ProjectBoardSearch {
  const { taskId: _currentTaskId, ...rest } = search;
  return taskId ? { ...rest, taskId } : rest;
}
