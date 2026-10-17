// Canonical route helpers (AGENTS.md rule 4): every screen has a URL, and
// any filter/sort state it carries lives in the query string so a reload reproduces it
// exactly. `generatedRouteMetadata` is produced from both TanStack trees and checked
// against in-progress/complete screen inventory rows by `pnpm check:inventory`; not-started
// rows remain planned URLs. Builders below define URL state contracts exercised by tests.

export { generatedRouteMetadata } from "./generated-route-metadata";

import { generatedRouteMetadata } from "./generated-route-metadata";
import {
  appendWorkItemQueryState,
  isWorkItemSearchSortField,
  parseWorkItemListSearch,
  parseWorkItemQueryState,
  type WorkItemListSearch,
  type WorkItemQueryState,
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

export type WorkItemActivityFilter = "everything" | "comments" | "public";
export type WorkItemDetailSearch = {
  activity?: Exclude<WorkItemActivityFilter, "everything">;
};
export type ProjectRouteParams = { workspaceId: string; projectId: string };

export const PROJECT_BACKLOG_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/backlog";
export const PROJECT_BOARD_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/board";
export const PROJECT_CALENDAR_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/calendar";
export const PROJECT_GANTT_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/gantt";

export function parseWorkItemDetailSearch(raw: unknown): WorkItemDetailSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  return candidate.activity === "comments" || candidate.activity === "public"
    ? { activity: candidate.activity }
    : {};
}

export type GodModeUsersSearch = {
  q?: string;
  side?: "staff" | "customer";
  active?: "true" | "false";
  organisationId?: string;
  cursor?: string;
  user?: string;
  action?: GodModeUserAction;
};

export const GOD_MODE_USER_ACTIONS = [
  "suspend",
  "unsuspend",
  "grant-admin",
  "reset-mfa",
  "sign-out",
  "deactivate",
] as const;
export type GodModeUserAction = (typeof GOD_MODE_USER_ACTIONS)[number];

export function godModeUserActionBinding(
  userId: string | undefined,
  action: GodModeUserAction | undefined,
) {
  return userId && action ? `${userId}:${action}` : "";
}

export type PendingActionsSearch = { cursor?: string };
export type SavedViewsSearch = { query?: string };
/**
 * The URL form of a saved view (`SV-19`): the view's context (`workspaceId`, `scope`,
 * `scopeId`, `layout`) and its query properties as plain parameters, so a link fully encodes
 * it. Every part is optional; a URL naming all four context parts is a complete snapshot.
 */
export type SavedViewUrlSearch = {
  workspaceId?: string;
  scope?: "workspace" | "project";
  scopeId?: string;
  layout?: string;
} & WorkItemQueryState;

const SAVED_VIEW_URL_LAYOUTS = [
  "board",
  "list",
  "table",
  "calendar",
  "timeline",
  "chart",
] as const;

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

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;
}

/**
 * Parses a saved view's URL. Total and bounded like every route parser: each property that is
 * absent or invalid is simply omitted, and no default is added, so a link keeps meaning what
 * it said. `position` is the list's rank order and is not a saved-view sort.
 */
export function parseSavedViewUrlSearch(raw: unknown): SavedViewUrlSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const { sort, ...rest } = parseWorkItemQueryState(value);
  const workspaceId = boundedId(value.workspaceId);
  const scopeId = boundedId(value.scopeId);
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(value.scope === "workspace" || value.scope === "project"
      ? { scope: value.scope }
      : {}),
    ...(scopeId ? { scopeId } : {}),
    ...((SAVED_VIEW_URL_LAYOUTS as readonly unknown[]).includes(value.layout)
      ? { layout: value.layout as string }
      : {}),
    ...(isWorkItemSearchSortField(sort) ? { sort } : {}),
    ...rest,
  };
}

export function parseSavedViewUrlSearchFromQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  return parseSavedViewUrlSearch({
    workspaceId: params.get("workspaceId") ?? undefined,
    scope: params.get("scope") ?? undefined,
    scopeId: params.get("scopeId") ?? undefined,
    layout: params.get("layout") ?? undefined,
    filter: params.get("filter") ?? undefined,
    filterMode: params.get("filterMode") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
    columns: params.get("columns") ?? undefined,
  });
}

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
      ? {
          user: value.user,
          ...(GOD_MODE_USER_ACTIONS.includes(value.action as GodModeUserAction)
            ? { action: value.action as GodModeUserAction }
            : {}),
        }
      : {}),
  };
}

export type ServiceCalendarListSearch = { cursor?: string };
export type SlaPolicyListSearch = { cursor?: string };

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

export type IntakeQueueSearch = {
  state:
    | "new"
    | "clarifying"
    | "accepted"
    | "declined"
    | "duplicate"
    | "withdrawn";
  ref?: string;
  cursor?: string;
};
export type RequestTypeEditorSearch = { requestTypeId?: string };
export type PortalCatalogueSearch = { q?: string; key?: string };
export type PortalSignInStage = "email" | "password" | "factor";
export type PortalSignInSearch = {
  stage: PortalSignInStage;
  factor: "totp" | "backup";
};

export function parseRequestTypeEditorSearch(
  raw: unknown,
): RequestTypeEditorSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.requestTypeId === "string" &&
    value.requestTypeId.length <= 200
    ? { requestTypeId: value.requestTypeId }
    : {};
}

export function parseIntakeSearch(raw: unknown): IntakeQueueSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const states = [
    "new",
    "clarifying",
    "accepted",
    "declined",
    "duplicate",
    "withdrawn",
  ] as const;
  const state = states.find((candidate) => candidate === value.state) ?? "new";
  const ref =
    typeof value.ref === "string" && /^SUB-[1-9]\d{0,9}$/u.test(value.ref)
      ? value.ref
      : undefined;
  const cursor =
    typeof value.cursor === "string" && value.cursor.length <= 2048
      ? value.cursor
      : undefined;
  return { state, ...(ref ? { ref } : {}), ...(cursor ? { cursor } : {}) };
}

export function parsePortalCatalogueSearch(
  raw: unknown,
): PortalCatalogueSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const q = typeof value.q === "string" ? value.q.slice(0, 200) : "";
  const key =
    typeof value.key === "string" && value.key.length <= 200
      ? value.key
      : undefined;
  return { ...(q ? { q } : {}), ...(key ? { key } : {}) };
}

export function parsePortalSignInSearch(raw: unknown): PortalSignInSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const stage = ["email", "password", "factor"].find(
    (candidate) => candidate === value.stage,
  ) as PortalSignInStage | undefined;
  return {
    stage: stage ?? "email",
    factor: value.factor === "backup" ? "backup" : "totp",
  };
}

export const routes = {
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
  requestTypes: {
    path: "/agent/settings/request-types" as const,
    build: (search: RequestTypeEditorSearch = {}) => {
      const resolved = parseRequestTypeEditorSearch(search);
      return resolved.requestTypeId
        ? `/agent/settings/request-types?requestTypeId=${encodeURIComponent(resolved.requestTypeId)}`
        : "/agent/settings/request-types";
    },
  },
  intakeQueue: {
    path: "/agent/triage" as const,
    build: (search: IntakeQueueSearch = { state: "new" }) => {
      const resolved = parseIntakeSearch(search);
      const query = new URLSearchParams({ state: resolved.state });
      if (resolved.ref) query.set("ref", resolved.ref);
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      return `/agent/triage?${query.toString()}`;
    },
  },
  /** Customer portal's P0 disabled landing page, rooted on its separate origin. */
  portalHome: {
    path: "/" as const,
    build: () => "/",
    parse: (pathname: string) => (pathname === "/" ? "/" : undefined),
  },
  portalSignIn: {
    path: "/sign-in" as const,
    build: (search: Partial<PortalSignInSearch> = {}) => {
      const resolved = parsePortalSignInSearch(search);
      const query = new URLSearchParams({ stage: resolved.stage });
      if (resolved.stage === "factor" && resolved.factor === "backup")
        query.set("factor", "backup");
      return `/sign-in?${query.toString()}`;
    },
  },
  portalCatalogue: {
    path: "/catalogue" as const,
    build: (search: PortalCatalogueSearch = {}) => {
      const resolved = parsePortalCatalogueSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.key) query.set("key", resolved.key);
      const suffix = query.toString();
      return suffix ? `/catalogue?${suffix}` : "/catalogue";
    },
  },
  portalSubmission: {
    path: "/submissions/$ref" as const,
    build: (params: { ref: string }) =>
      `/submissions/${encodeURIComponent(params.ref)}`,
  },
  /** `docs/02-design/screen-inventory.md` "Work — list", `/agent/projects/{key}/work`. */
  workItemList: {
    path: "/agent/projects/$projectKey/work" as const,
    build: (
      params: { projectKey: string },
      search: Partial<WorkItemListSearch> = {},
    ) => {
      const resolved = parseWorkItemListSearch(search);
      const query = new URLSearchParams({
        layout: resolved.layout,
        sort: resolved.sort,
        dir: resolved.dir,
      });
      appendWorkItemQueryState(query, {
        filter: resolved.filter,
        filterMode: resolved.filterMode,
        columns: resolved.columns,
      });
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
  /** `docs/02-design/screen-inventory.md` "Saved views index", `/agent/views`. */
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
  /**
   * `docs/02-design/screen-inventory.md` "Saved view", `/agent/views/{id}`. The query string
   * encodes the whole view (`SV-19`), so the link can be shared with someone who cannot open
   * the saved view itself.
   */
  savedView: {
    path: "/agent/views/$id" as const,
    build: (params: { id: string }, search: SavedViewUrlSearch = {}) => {
      const resolved = parseSavedViewUrlSearch(search);
      const query = new URLSearchParams();
      if (resolved.workspaceId) query.set("workspaceId", resolved.workspaceId);
      if (resolved.scope) query.set("scope", resolved.scope);
      if (resolved.scopeId) query.set("scopeId", resolved.scopeId);
      if (resolved.layout) query.set("layout", resolved.layout);
      appendWorkItemQueryState(query, resolved);
      const suffix = query.toString();
      return `/agent/views/${encodeURIComponent(params.id)}${suffix ? `?${suffix}` : ""}`;
    },
  },
  /** God Mode Users directory and its query-string-backed selection/filters. */
  godModeUsers: {
    path: "/agent/god-mode/users" as const,
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
      if (resolved.user && resolved.action)
        query.set("action", resolved.action);
      const suffix = query.toString();
      return suffix
        ? `/agent/god-mode/users?${suffix}`
        : "/agent/god-mode/users";
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
  pendingAction: {
    path: "/agent/settings/profile/pending-actions/$id" as const,
    build: (params: { id: string }) =>
      `/agent/settings/profile/pending-actions/${encodeURIComponent(params.id)}`,
  },
};

export function parsePendingActionsSearchFromQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  return parsePendingActionsSearch({ cursor: params.get("cursor") });
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
