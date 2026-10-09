// Canonical route helpers (AGENTS.md rule 4): every screen has a URL, and
// any filter/sort state it carries lives in the query string so a reload reproduces it
// exactly. `generatedRouteMetadata` is produced from both TanStack trees and checked
// against in-progress/complete screen inventory rows by `pnpm check:inventory`; not-started
// rows remain planned URLs. Builders below define URL state contracts exercised by tests.

export { generatedRouteMetadata } from "./generated-route-metadata";

import { generatedRouteMetadata } from "./generated-route-metadata";
import {
  appendProjectViewSearchParams,
  type ProjectBacklogSearch,
  type ProjectBoardSearch,
  parseProjectBacklogSearch,
  parseProjectBoardSearch,
  parseProjectViewSearchFromParams,
} from "./project-board-search";
import {
  type ProjectCalendarSearch,
  parseProjectCalendarSearch,
} from "./project-calendar-search";
import {
  parseWorkItemListSearch,
  type WorkItemFilterMode,
  type WorkItemListSearch,
  type WorkItemSearchColumn,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "./work-item-list-search";

export * from "./work-item-list-search";

export type RouteSurface = keyof typeof generatedRouteMetadata;

function assertGeneratedRoute(surface: RouteSurface, template: string) {
  if (
    !(generatedRouteMetadata[surface] as readonly string[]).includes(template)
  )
    throw new Error(`Unknown generated ${surface} route: ${template}`);
}

/** Builds a path from a generated route template, requiring every dynamic segment. */
export function buildGeneratedRouteUrl(
  surface: RouteSurface,
  template: string,
  params: Record<string, string> = {},
): string {
  assertGeneratedRoute(surface, template);
  return template.replace(/\$([A-Za-z0-9_]+)/gu, (_match, name: string) => {
    const value = params[name];
    if (typeof value !== "string" || value.length === 0)
      throw new Error(`Route ${template} requires parameter ${name}.`);
    return encodeURIComponent(value);
  });
}

/** Parses a generated route URL and returns decoded dynamic segments, if it matches. */
export function parseGeneratedRouteUrl(
  surface: RouteSurface,
  template: string,
  input: string,
): { pathname: string; params: Record<string, string> } | undefined {
  assertGeneratedRoute(surface, template);
  const url = new URL(input, "https://route.invalid");
  const names: string[] = [];
  const pattern = template
    .split(/(\$[A-Za-z0-9_]+)/gu)
    .map((part) => {
      if (part.startsWith("$")) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    })
    .join("");
  const match = new RegExp(`^${pattern}$`, "u").exec(url.pathname);
  if (!match) return undefined;
  const params = Object.fromEntries(
    names.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
  );
  return { pathname: url.pathname, params };
}

export type ServiceCalendarListSearch = { cursor?: string };
export type SlaPolicyListSearch = { cursor?: string };
export type IdentityConnectionEventsSearch = { eventsCursor?: string };
export type PendingActionsSearch = { cursor?: string };
export type SavedViewsSearch = { query?: string };
export type SavedViewUrlSearch = {
  workspaceId: string;
  scope: "workspace" | "project";
  scopeId: string;
  layout: string;
  filter?: string;
  filterMode?: WorkItemFilterMode;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  columns?: WorkItemSearchColumn[];
  cursor?: string;
};
export type MyWorkSearch = { lens: "approvals" };
export type WorkItemActivityFilter = "everything" | "comments" | "public";
export type WorkItemDetailSearch = { activity?: WorkItemActivityFilter };
export type ProjectRouteParams = { workspaceId: string; projectId: string };

const PROJECT_BACKLOG_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/backlog";
const PROJECT_BOARD_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/board";
const PROJECT_CALENDAR_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/calendar";
const PROJECT_GANTT_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/gantt";

export function parseWorkItemDetailSearch(raw: unknown): WorkItemDetailSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  return candidate.activity === "comments" || candidate.activity === "public"
    ? { activity: candidate.activity }
    : {};
}

export function parseMyWorkSearch(raw: unknown): MyWorkSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  return { lens: candidate.lens === "approvals" ? "approvals" : "approvals" };
}

export function parsePendingActionsSearch(raw: unknown): PendingActionsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const cursor =
    typeof value.cursor === "string" &&
    value.cursor.length > 0 &&
    value.cursor.length <= 2048
      ? value.cursor
      : undefined;
  return { cursor };
}

export function parseSavedViewsSearch(raw: unknown): SavedViewsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof value.query === "string" && value.query.trim()
      ? { query: value.query.trim().slice(0, 200) }
      : {}),
  };
}

export function parseSavedViewUrlSearch(
  raw: unknown,
): Partial<SavedViewUrlSearch> {
  const value = (raw ?? {}) as Record<string, unknown>;
  const { layout: _listLayout, ...filterState } =
    parseWorkItemListSearch(value);
  return {
    ...(typeof value.workspaceId === "string" && value.workspaceId.length <= 200
      ? { workspaceId: value.workspaceId }
      : {}),
    ...(value.scope === "workspace" || value.scope === "project"
      ? { scope: value.scope }
      : {}),
    ...(typeof value.scopeId === "string" && value.scopeId.length <= 200
      ? { scopeId: value.scopeId }
      : {}),
    ...(typeof value.layout === "string" && value.layout.length <= 32
      ? { layout: value.layout }
      : {}),
    ...filterState,
    ...(typeof value.cursor === "string" && value.cursor.length <= 4096
      ? { cursor: value.cursor }
      : {}),
  };
}

export function parseSavedViewUrlSearchFromQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  return parseSavedViewUrlSearch({
    workspaceId: params.get("workspaceId"),
    scope: params.get("scope"),
    scopeId: params.get("scopeId"),
    layout: params.get("layout"),
    filter: params.get("filter"),
    filterMode: params.get("filterMode"),
    sort: params.get("sort"),
    dir: params.get("dir"),
    columns: params.get("columns"),
    cursor: params.get("cursor"),
  });
}

export function parseIdentityConnectionEventsSearch(
  raw: unknown,
): IdentityConnectionEventsSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const eventsCursor =
    typeof candidate.eventsCursor === "string" &&
    candidate.eventsCursor.length > 0 &&
    candidate.eventsCursor.length <= 512
      ? candidate.eventsCursor
      : undefined;
  return { eventsCursor };
}

export function parseIdentityConnectionEventsSearchFromQueryString(
  queryString: string,
) {
  const params = new URLSearchParams(queryString);
  return parseIdentityConnectionEventsSearch({
    eventsCursor: params.get("eventsCursor"),
  });
}

export function parseSlaPolicyListSearch(raw: unknown): SlaPolicyListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const cursor =
    typeof candidate.cursor === "string" &&
    candidate.cursor.length > 0 &&
    candidate.cursor.length <= 2048
      ? candidate.cursor
      : undefined;
  return { cursor };
}

export function parseServiceCalendarListSearch(
  raw: unknown,
): ServiceCalendarListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const cursor =
    typeof candidate.cursor === "string" &&
    candidate.cursor.length > 0 &&
    candidate.cursor.length <= 2048
      ? candidate.cursor
      : undefined;
  return { cursor };
}

export function parseServiceCalendarListSearchFromQueryString(
  queryString: string,
) {
  const params = new URLSearchParams(queryString);
  return parseServiceCalendarListSearch({
    cursor: params.get("cursor"),
  });
}

export const routes = {
  /** Project backlog and its task-panel URL state. */
  projectBacklog: {
    path: PROJECT_BACKLOG_PATH,
    build: (
      params: ProjectRouteParams,
      search: Partial<ProjectBacklogSearch> = {},
    ) => {
      const pathname = buildGeneratedRouteUrl(
        "agent",
        PROJECT_BACKLOG_PATH,
        params,
      );
      const query = new URLSearchParams();
      appendProjectViewSearchParams(query, parseProjectBacklogSearch(search));
      const suffix = query.toString();
      return `${pathname}${suffix ? `?${suffix}` : ""}`;
    },
    parse: (input: string) => {
      const match = parseGeneratedRouteUrl(
        "agent",
        PROJECT_BACKLOG_PATH,
        input,
      );
      if (!match) return undefined;
      const query = new URL(input, "https://route.invalid").searchParams;
      return {
        params: match.params as ProjectRouteParams,
        search: parseProjectBacklogSearch(
          parseProjectViewSearchFromParams(query),
        ),
      };
    },
  },
  /** Project Board/List layout and task-panel URL state. */
  projectBoard: {
    path: PROJECT_BOARD_PATH,
    build: (
      params: ProjectRouteParams,
      search: Partial<ProjectBoardSearch> = {},
    ) => {
      const pathname = buildGeneratedRouteUrl(
        "agent",
        PROJECT_BOARD_PATH,
        params,
      );
      const query = new URLSearchParams();
      appendProjectViewSearchParams(query, parseProjectBoardSearch(search));
      const suffix = query.toString();
      return `${pathname}${suffix ? `?${suffix}` : ""}`;
    },
    parse: (input: string) => {
      const match = parseGeneratedRouteUrl("agent", PROJECT_BOARD_PATH, input);
      if (!match) return undefined;
      const query = new URL(input, "https://route.invalid").searchParams;
      return {
        params: match.params as ProjectRouteParams,
        search: parseProjectBoardSearch(
          parseProjectViewSearchFromParams(query),
        ),
      };
    },
  },
  /** Project calendar month and task-panel URL state. */
  projectCalendar: {
    path: PROJECT_CALENDAR_PATH,
    build: (
      params: ProjectRouteParams,
      search: Partial<ProjectCalendarSearch> = {},
    ) => {
      const pathname = buildGeneratedRouteUrl(
        "agent",
        PROJECT_CALENDAR_PATH,
        params,
      );
      const query = new URLSearchParams();
      appendProjectViewSearchParams(query, parseProjectCalendarSearch(search));
      const suffix = query.toString();
      return `${pathname}${suffix ? `?${suffix}` : ""}`;
    },
    parse: (input: string) => {
      const match = parseGeneratedRouteUrl(
        "agent",
        PROJECT_CALENDAR_PATH,
        input,
      );
      if (!match) return undefined;
      const query = new URL(input, "https://route.invalid").searchParams;
      return {
        params: match.params as ProjectRouteParams,
        search: parseProjectCalendarSearch(
          parseProjectViewSearchFromParams(query),
        ),
      };
    },
  },
  /** Project Gantt task-panel URL state. */
  projectGantt: {
    path: PROJECT_GANTT_PATH,
    build: (
      params: ProjectRouteParams,
      search: Partial<ProjectBoardSearch> = {},
    ) => {
      const pathname = buildGeneratedRouteUrl(
        "agent",
        PROJECT_GANTT_PATH,
        params,
      );
      const query = new URLSearchParams();
      appendProjectViewSearchParams(query, search);
      const suffix = query.toString();
      return `${pathname}${suffix ? `?${suffix}` : ""}`;
    },
    parse: (input: string) => {
      const match = parseGeneratedRouteUrl("agent", PROJECT_GANTT_PATH, input);
      if (!match) return undefined;
      return {
        params: match.params as ProjectRouteParams,
        search: parseProjectViewSearchFromParams(
          new URL(input, "https://route.invalid").searchParams,
        ),
      };
    },
  },
  /** `docs/02-design/screen-inventory.md` "Approvals inbox". */
  myWork: {
    path: "/agent/my-work" as const,
    build: (search: MyWorkSearch = { lens: "approvals" }) => {
      const resolved = parseMyWorkSearch(search);
      return `/agent/my-work?lens=${resolved.lens}`;
    },
  },
  /** Customer portal's P0 disabled landing page, rooted on its separate origin. */
  portalHome: {
    path: "/" as const,
    build: () => "/",
    parse: (pathname: string) => (pathname === "/" ? "/" : undefined),
  },
  /** Customer portal's approval list (`customer-portal.md`, `approvals.md`). */
  portalApprovals: {
    path: "/portal/approvals" as const,
    build: () => "/portal/approvals",
    parse: (pathname: string) =>
      pathname === "/portal/approvals" ? "/portal/approvals" : undefined,
  },
  /** `docs/02-design/screen-inventory.md` "Workspace — service calendars". */
  serviceCalendars: {
    path: "/agent/settings/calendars" as const,
    build: (search: ServiceCalendarListSearch = {}) => {
      const resolved = parseServiceCalendarListSearch(search);
      const query = new URLSearchParams();
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      const suffix = query.toString();
      return suffix
        ? `/agent/settings/calendars?${suffix}`
        : "/agent/settings/calendars";
    },
  },
  /** `docs/02-design/screen-inventory.md` "Service calendar editor". */
  serviceCalendarEditor: {
    path: "/agent/settings/calendars/$id" as const,
    build: (params: { id: string }, year?: number) => {
      const path = `/agent/settings/calendars/${encodeURIComponent(params.id)}`;
      return year === undefined ? path : `${path}?year=${year}`;
    },
  },
  /** `docs/02-design/screen-inventory.md` "Workspace — SLA policies". */
  slaPolicies: {
    path: "/agent/settings/sla-policies" as const,
    build: (search: SlaPolicyListSearch = {}) => {
      const resolved = parseSlaPolicyListSearch(search);
      const query = new URLSearchParams();
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      const suffix = query.toString();
      return suffix
        ? `/agent/settings/sla-policies?${suffix}`
        : "/agent/settings/sla-policies";
    },
  },
  /** `docs/02-design/screen-inventory.md` "SLA policy editor". */
  slaPolicyEditor: {
    path: "/agent/settings/sla-policies/$id" as const,
    build: (params: { id: string }) =>
      `/agent/settings/sla-policies/${encodeURIComponent(params.id)}`,
  },
  /** `docs/03-features/identity-provisioning.md` God Mode connection settings. */
  identityConnections: {
    path: "/god-mode/authentication" as const,
    build: () => "/god-mode/authentication",
  },
  identityConnectionCreate: {
    path: "/god-mode/authentication/new" as const,
    build: () => "/god-mode/authentication/new",
  },
  identityConnectionSettings: {
    path: "/god-mode/authentication/$id" as const,
    build: (
      params: { id: string },
      search: IdentityConnectionEventsSearch = {},
    ) => {
      const pathname = `/god-mode/authentication/${encodeURIComponent(params.id)}`;
      const resolved = parseIdentityConnectionEventsSearch(search);
      if (!resolved.eventsCursor) return pathname;
      const query = new URLSearchParams({
        eventsCursor: resolved.eventsCursor,
      });
      return `${pathname}?${query.toString()}`;
    },
  },
  /** `docs/02-design/screen-inventory.md` "Work — list", `/agent/projects/{key}/work`. */
  workItemList: {
    path: "/agent/projects/$projectKey/work" as const,
    build: (
      params: { projectKey: string },
      search: Partial<WorkItemListSearch> = {},
    ) => {
      const resolved = parseWorkItemListSearch(search);
      const query = new URLSearchParams({ layout: resolved.layout });
      if (resolved.sort) query.set("sort", resolved.sort);
      if (resolved.dir) query.set("dir", resolved.dir);
      if (resolved.filter) query.set("filter", resolved.filter);
      if (resolved.filterMode) query.set("filterMode", resolved.filterMode);
      if (resolved.columns)
        query.set("columns", JSON.stringify(resolved.columns));
      return `/agent/projects/${encodeURIComponent(params.projectKey)}/work?${query.toString()}`;
    },
  },
  /**
   * `docs/02-design/screen-inventory.md` "Work item — full page",
   * `/agent/work-items/{key}` -- the read-only first slice of the detail page (the
   * route itself has existed since #306, resolving to an honest stub; that stub is now
   * the real page). The list's rows still link here as their row-open destination, and
   * the URL contract did not change when the real page landed.
   */
  workItemDetail: {
    path: "/agent/work-items/$key" as const,
    build: (
      params: { key: string },
      search: Partial<WorkItemDetailSearch> = {},
    ) => {
      const resolved = parseWorkItemDetailSearch(search);
      const query = new URLSearchParams();
      if (resolved.activity) query.set("activity", resolved.activity);
      const suffix = query.toString();
      return `/agent/work-items/${encodeURIComponent(params.key)}${suffix ? `?${suffix}` : ""}`;
    },
  },
  /** God Mode Users directory and its query-string-backed selection/filters. */
  godModeUsers: {
    path: "/god-mode/users" as const,
    build: (search: Partial<GodModeUsersSearch> = {}) => {
      const resolved = parseGodModeUsersSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.side) query.set("side", resolved.side);
      if (resolved.active) query.set("active", resolved.active);
      if (resolved.organisationId)
        query.set("organisationId", resolved.organisationId);
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      if (resolved.user) query.set("user", resolved.user);
      const suffix = query.toString();
      return suffix ? `/god-mode/users?${suffix}` : "/god-mode/users";
    },
  },
  /** PA-6 requester-owned browser approval list and item. */
  pendingActions: {
    path: "/agent/settings/profile/pending-actions" as const,
    build: (search: PendingActionsSearch = {}) => {
      const resolved = parsePendingActionsSearch(search);
      const query = new URLSearchParams();
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      const suffix = query.toString();
      return suffix
        ? `/agent/settings/profile/pending-actions?${suffix}`
        : "/agent/settings/profile/pending-actions";
    },
  },
  savedViews: {
    path: "/agent/views" as const,
    build: (search: SavedViewsSearch = {}) => {
      const resolved = parseSavedViewsSearch(search);
      const query = new URLSearchParams();
      if (resolved.query) query.set("query", resolved.query);
      const suffix = query.toString();
      return suffix ? `/agent/views?${suffix}` : "/agent/views";
    },
  },
  savedView: {
    path: "/agent/views/$id" as const,
    build: (params: { id: string }, search: SavedViewUrlSearch) => {
      const resolved = parseSavedViewUrlSearch(search) as SavedViewUrlSearch;
      const query = new URLSearchParams({
        workspaceId: resolved.workspaceId,
        scope: resolved.scope,
        scopeId: resolved.scopeId,
        layout: resolved.layout,
      });
      if (resolved.filter) query.set("filter", resolved.filter);
      if (resolved.filterMode) query.set("filterMode", resolved.filterMode);
      if (resolved.sort) query.set("sort", resolved.sort);
      if (resolved.dir) query.set("dir", resolved.dir);
      if (resolved.columns)
        query.set("columns", JSON.stringify(resolved.columns));
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      return `/agent/views/${encodeURIComponent(params.id)}?${query.toString()}`;
    },
  },
  pendingAction: {
    path: "/agent/settings/profile/pending-actions/$id" as const,
    build: (params: { id: string }) =>
      `/agent/settings/profile/pending-actions/${encodeURIComponent(params.id)}`,
  },
};

export type GodModeUsersSearch = {
  q?: string;
  side?: "staff" | "customer";
  active?: "true" | "false";
  organisationId?: string;
  cursor?: string;
  user?: string;
};

export function parseGodModeUsersSearch(raw: unknown): GodModeUsersSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof value.q === "string" && value.q.trim()
      ? { q: value.q.trim().slice(0, 200) }
      : {}),
    ...(value.side === "staff" || value.side === "customer"
      ? { side: value.side }
      : {}),
    ...(value.active === "true" || value.active === "false"
      ? { active: value.active }
      : {}),
    ...(typeof value.organisationId === "string" && value.organisationId
      ? { organisationId: value.organisationId }
      : {}),
    ...(typeof value.cursor === "string" && value.cursor
      ? { cursor: value.cursor }
      : {}),
    ...(typeof value.user === "string" && value.user
      ? { user: value.user }
      : {}),
  };
}

/** The inverse of `routes.workItemList.build`'s query string, for the round-trip test. */
export function parseWorkItemListSearchFromQueryString(
  queryString: string,
): WorkItemListSearch {
  const params = new URLSearchParams(queryString);
  return parseWorkItemListSearch({
    layout: params.get("layout") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
    filter: params.get("filter") ?? undefined,
    filterMode: params.get("filterMode") ?? undefined,
    columns: params.get("columns") ?? undefined,
  });
}
