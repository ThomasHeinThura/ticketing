import {
  PROJECT_BACKLOG_PATH,
  PROJECT_BOARD_PATH,
  PROJECT_CALENDAR_PATH,
  PROJECT_GANTT_PATH,
  type ProjectRouteParams,
} from "@/lib/routes";
import { translateLegacyProjectView } from "./legacy-project-view";
import { parseProjectRouterSearch } from "./project-board-search";
import { parseWorkItemHierarchySearch } from "./work-item-hierarchy-search";
import { isValidWorkItemKeyParam } from "./work-item-list-search";
import { parseWorkItemRelationsSearch } from "./work-item-relations-search";

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

export { normalizeCanonicalWorkItemSelection } from "./normalize-canonical-work-item-selection";

function bridgeProjectSelection(
  query: URLSearchParams,
  view: ProjectView,
  canonicalProject: boolean,
) {
  const item = query.get("item");
  const taskId = query.get("taskId");
  const schedule = view === "calendar" || view === "gantt";
  const canonical =
    canonicalProject && ["board", "list", "backlog"].includes(view);
  let selected = isValidWorkItemKeyParam(item)
    ? item
    : isValidWorkItemKeyParam(taskId)
      ? taskId
      : undefined;
  if (schedule && isValidWorkItemKeyParam(item)) {
    query.set("taskId", item);
    query.delete("item");
  } else if (canonical && selected) {
    query.set("item", selected);
    if (isValidWorkItemKeyParam(taskId)) query.delete("taskId");
  } else if (schedule) {
    selected = isValidWorkItemKeyParam(taskId) ? taskId : undefined;
  }
  const hierarchy = parseWorkItemHierarchySearch({
    hierarchy: query.get("hierarchy"),
  }).hierarchy;
  const relations = parseWorkItemRelationsSearch({
    relations: query.get("relations"),
  }).relations;
  for (const [name, state] of [
    ["hierarchy", hierarchy],
    ["relations", relations],
  ] as const) {
    if (state && (!selected || state.itemKey === selected))
      query.set(name, JSON.stringify(state));
    else query.delete(name);
  }
}

export function buildProjectViewSwitchUrl(
  view: ProjectView,
  params: ProjectRouteParams & { projectKey?: string },
  currentSearch: string,
) {
  const query = new URLSearchParams(currentSearch);
  bridgeProjectSelection(query, view, Boolean(params.projectKey));
  if (params.projectKey && ["board", "list", "backlog"].includes(view)) {
    if (view !== "backlog") query.set("layout", view);
    const raw = parseProjectRouterSearch(query.toString());
    const translated = translateLegacyProjectView(
      raw,
      params.projectKey,
      view === "backlog" ? "backlog" : "board",
    );
    // A project switch never silently discards a saved predicate or guesses a legacy
    // task's canonical key. The compatibility entry point handles both explicitly.
    if (translated.unsupported.length === 0 && !translated.legacyTaskId) {
      if (raw.priority || raw.sort === "number") return translated.href;
      const suffix = query.toString();
      const path = `/agent/projects/${encodeURIComponent(params.projectKey)}/${view === "backlog" ? "backlog" : "work"}`;
      return suffix ? `${path}?${suffix}` : path;
    }
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
