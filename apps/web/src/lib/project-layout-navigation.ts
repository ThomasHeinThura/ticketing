import { type ProjectRouteParams, routes } from "@/lib/routes";

export type ProjectView = "backlog" | "board" | "calendar" | "gantt" | "list";

const PROJECT_VIEW_SHORTCUTS = [
  "board",
  "list",
  "calendar",
  "gantt",
  "backlog",
] as const satisfies readonly ProjectView[];

export function createProjectViewShortcutHandlers(
  params: ProjectRouteParams,
  currentSearch: string,
  navigate: (href: string) => void,
) {
  return Object.fromEntries(
    PROJECT_VIEW_SHORTCUTS.map((view) => [
      view,
      () => navigate(buildProjectViewSwitchUrl(view, params, currentSearch)),
    ]),
  ) as Record<ProjectView, () => void>;
}

export function buildProjectViewSwitchUrl(
  view: ProjectView,
  params: ProjectRouteParams,
  currentSearch: string,
) {
  const taskId = new URLSearchParams(currentSearch).get("taskId") ?? undefined;
  const search = taskId ? { taskId } : {};
  switch (view) {
    case "backlog":
      return routes.projectBacklog.build(params, search);
    case "board":
      return routes.projectBoard.build(params, { ...search, layout: "board" });
    case "calendar":
      return routes.projectCalendar.build(params, search);
    case "gantt":
      return routes.projectGantt.build(params, search);
    case "list":
      return routes.projectBoard.build(params, { ...search, layout: "list" });
  }
}
