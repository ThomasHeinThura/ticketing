import { parseProjectViewSearchFromParams } from "@/lib/project-board-search";
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
  onLayoutChange?: (layout: "board" | "list") => void,
) {
  return Object.fromEntries(
    PROJECT_VIEW_SHORTCUTS.map((view) => [
      view,
      () => {
        if (view === "board" || view === "list") onLayoutChange?.(view);
        navigate(buildProjectViewSwitchUrl(view, params, currentSearch));
      },
    ]),
  ) as Record<ProjectView, () => void>;
}

export function buildProjectViewSwitchUrl(
  view: ProjectView,
  params: ProjectRouteParams,
  currentSearch: string,
) {
  const search = parseProjectViewSearchFromParams(
    new URLSearchParams(currentSearch),
  );
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
