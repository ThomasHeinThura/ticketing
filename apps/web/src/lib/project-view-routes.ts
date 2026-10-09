import {
  appendProjectViewSearchParams,
  type ProjectViewSearch,
  parseProjectBacklogSearch,
  parseProjectBoardSearch,
  parseProjectCalendarSearch,
  parseProjectViewSearchFromParams,
} from "@/lib/project-board-search";
import {
  PROJECT_BACKLOG_PATH,
  PROJECT_BOARD_PATH,
  PROJECT_CALENDAR_PATH,
  PROJECT_GANTT_PATH,
  type ProjectRouteParams,
} from "@/lib/routes";

function buildProjectPath(path: string, params: ProjectRouteParams) {
  return path.replace(/\$([A-Za-z0-9_]+)/gu, (_match, name: string) => {
    const value = params[name as keyof ProjectRouteParams];
    if (typeof value !== "string" || value.length === 0)
      throw new Error(`Route ${path} requires parameter ${name}.`);
    return encodeURIComponent(value);
  });
}

function parseProjectPath(path: string, input: string) {
  const pathname = new URL(input, "https://route.invalid").pathname;
  const expected = path.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, part] of expected.entries()) {
    if (part.startsWith("$"))
      params[part.slice(1)] = decodeURIComponent(actual[index]);
    else if (part !== actual[index]) return undefined;
  }
  return {
    pathname,
    params: params as ProjectRouteParams,
  };
}

function createProjectRoute<Search extends ProjectViewSearch>(
  path: string,
  parseSearch: (raw: unknown) => Search,
) {
  return {
    path,
    build(params: ProjectRouteParams, search: Partial<Search> = {}) {
      const pathname = buildProjectPath(path, params);
      const query = new URLSearchParams();
      appendProjectViewSearchParams(query, search, parseSearch);
      const suffix = query.toString();
      return `${pathname}${suffix ? `?${suffix}` : ""}`;
    },
    parse(input: string) {
      const match = parseProjectPath(path, input);
      if (!match) return undefined;
      const query = new URL(input, "https://route.invalid").searchParams;
      return {
        params: match.params,
        search: parseProjectViewSearchFromParams(query, parseSearch),
      };
    },
  };
}

const parseCalendarSearch = (raw: unknown) =>
  parseProjectCalendarSearch((raw ?? {}) as Record<string, unknown>);

export const projectViewRoutes = {
  /** Project backlog and its task-panel URL state. */
  projectBacklog: createProjectRoute(
    PROJECT_BACKLOG_PATH,
    parseProjectBacklogSearch,
  ),
  /** Project Board/List layout and task-panel URL state. */
  projectBoard: createProjectRoute(PROJECT_BOARD_PATH, parseProjectBoardSearch),
  /** Project calendar month and task-panel URL state. */
  projectCalendar: createProjectRoute(
    PROJECT_CALENDAR_PATH,
    parseCalendarSearch,
  ),
  /** Project Gantt task-panel URL state. */
  projectGantt: createProjectRoute(PROJECT_GANTT_PATH, parseProjectBoardSearch),
};
