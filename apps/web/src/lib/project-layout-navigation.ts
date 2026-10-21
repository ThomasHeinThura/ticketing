import {
  PROJECT_BACKLOG_PATH,
  PROJECT_BOARD_PATH,
  PROJECT_CALENDAR_PATH,
  PROJECT_GANTT_PATH,
  type ProjectRouteParams,
} from "@/lib/routes";

export type ProjectView = "backlog" | "board" | "calendar" | "gantt" | "list";

const PROJECT_VIEW_SHORTCUTS = [
  "board",
  "list",
  "calendar",
  "gantt",
  "backlog",
] as const satisfies readonly ProjectView[];

export function createProjectViewShortcutHandlers(
  params: ProjectRouteParams & { projectKey?: string },
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
  params: ProjectRouteParams & { projectKey?: string },
  currentSearch: string,
) {
  const query = new URLSearchParams(currentSearch);
  if (params.projectKey && ["board", "list", "backlog"].includes(view)) {
    if (view !== "backlog") query.set("layout", view);
    const suffix = query.toString();
    const path = `/agent/projects/${encodeURIComponent(params.projectKey)}/${view === "backlog" ? "backlog" : "work"}`;
    return suffix ? `${path}?${suffix}` : path;
  }
  let path: string;
  switch (view) {
    case "backlog":
      path = PROJECT_BACKLOG_PATH;
      break;
    case "board":
      path = PROJECT_BOARD_PATH;
      query.set("layout", "board");
      break;
    case "calendar":
      path = PROJECT_CALENDAR_PATH;
      break;
    case "gantt":
      path = PROJECT_GANTT_PATH;
      break;
    case "list":
      path = PROJECT_BOARD_PATH;
      query.set("layout", "list");
      break;
  }
  const pathname = path.replace(
    /\$([A-Za-z0-9_]+)/g,
    (_match, name: string) => {
      const value = params[name as keyof ProjectRouteParams];
      if (typeof value !== "string" || value.length === 0)
        throw new Error(`Route ${path} requires parameter ${name}.`);
      return encodeURIComponent(value);
    },
  );
  const suffix = query.toString();
  return `${pathname}${suffix ? `?${suffix}` : ""}`;
}
