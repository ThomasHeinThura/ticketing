import { type ProjectRouteParams, routes } from "@/lib/routes";

export type ProjectView = "backlog" | "board" | "calendar" | "gantt";

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
      return routes.projectBoard.build(params, search);
    case "calendar":
      return routes.projectCalendar.build(params, search);
    case "gantt":
      return routes.projectGantt.build(params, search);
  }
}
