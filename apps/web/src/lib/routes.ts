// Canonical route helpers (AGENTS.md rule 4): every screen has a URL, and
// any filter/sort state it carries lives in the query string so a reload reproduces it
// exactly. `generatedRouteMetadata` is produced from both TanStack trees and checked
// against in-progress/complete screen inventory rows by `pnpm check:inventory`; not-started
// rows remain planned URLs. Builders below define URL state contracts exercised by tests.

export { generatedRouteMetadata } from "./generated-route-metadata";

import { generatedRouteMetadata } from "./generated-route-metadata";

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

export const WORK_ITEM_SORT_FIELDS = [
  "key",
  "title",
  "priority",
  "dueDate",
] as const;
export type WorkItemSortField = (typeof WORK_ITEM_SORT_FIELDS)[number];

export const WORK_ITEM_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type WorkItemSortDirection = (typeof WORK_ITEM_SORT_DIRECTIONS)[number];

export const WORK_ITEM_SEARCH_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
export type WorkItemSearchColumn = (typeof WORK_ITEM_SEARCH_COLUMNS)[number];
export type WorkItemFilterMode = "visual" | "text";

// The screen inventory names three `layout` values on this one route
// (`/agent/projects/{key}/work?layout=board|list|table`). Only `list` is built by this
// slice -- board and table are separate, not-yet-built P1 rows in
// `docs/02-design/screen-inventory.md`. `layout` is still parsed from the URL (not
// hardcoded) so a bookmark/link naming a future layout degrades to `list` today instead
// of 404ing, and starts working once that layout ships without changing the URL contract.
export const WORK_ITEM_LIST_LAYOUTS = ["list"] as const;
export type WorkItemListLayout = (typeof WORK_ITEM_LIST_LAYOUTS)[number];

export type WorkItemListSearch = {
  layout: WorkItemListLayout;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  filter?: string;
  filterMode?: WorkItemFilterMode;
  columns?: WorkItemSearchColumn[];
};

export function resolveWorkItemListSort(
  search: Pick<WorkItemListSearch, "sort" | "dir">,
) {
  const field = search.sort ?? "key";
  const order = search.dir ?? "asc";
  return {
    field,
    order,
    querySort:
      search.sort !== undefined || search.dir !== undefined
        ? [{ field, order }]
        : undefined,
  };
}

export const WORK_ITEM_FILTER_URL_MAX_LENGTH = 8192;

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
export function parseRequestTypeEditorSearch(
  raw: unknown,
): RequestTypeEditorSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.requestTypeId === "string" &&
    value.requestTypeId.length <= 200
    ? { requestTypeId: value.requestTypeId }
    : {};
}
export type PortalCatalogueSearch = { q?: string; key?: string };

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
  const q = typeof value.q === "string" ? value.q.trim().slice(0, 200) : "";
  const key =
    typeof value.key === "string" && value.key.length <= 200
      ? value.key
      : undefined;
  return { ...(q ? { q } : {}), ...(key ? { key } : {}) };
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

export const DEFAULT_WORK_ITEM_LIST_SEARCH: WorkItemListSearch = {
  layout: "list",
};

function isWorkItemSortField(value: unknown): value is WorkItemSortField {
  return (
    typeof value === "string" &&
    (WORK_ITEM_SORT_FIELDS as readonly string[]).includes(value)
  );
}

function isWorkItemSortDirection(
  value: unknown,
): value is WorkItemSortDirection {
  return (
    typeof value === "string" &&
    (WORK_ITEM_SORT_DIRECTIONS as readonly string[]).includes(value)
  );
}

function isWorkItemListLayout(value: unknown): value is WorkItemListLayout {
  return (
    typeof value === "string" &&
    (WORK_ITEM_LIST_LAYOUTS as readonly string[]).includes(value)
  );
}

/**
 * Parses a raw, possibly malformed search object (a hand-edited URL, an old bookmark, an
 * unset param) into a valid `WorkItemListSearch`, falling back to the default for any
 * missing or invalid field. Never throws -- this is also this route's `validateSearch`.
 */
export function parseWorkItemListSearch(raw: unknown): WorkItemListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  let columns: unknown = candidate.columns;
  if (typeof columns === "string") {
    try {
      columns = JSON.parse(columns) as unknown;
    } catch {
      columns = undefined;
    }
  }
  const validColumns =
    Array.isArray(columns) &&
    columns.length <= WORK_ITEM_SEARCH_COLUMNS.length &&
    columns.every(
      (column) =>
        typeof column === "string" &&
        (WORK_ITEM_SEARCH_COLUMNS as readonly string[]).includes(column),
    ) &&
    new Set(columns).size === columns.length;
  return {
    layout: isWorkItemListLayout(candidate.layout)
      ? candidate.layout
      : DEFAULT_WORK_ITEM_LIST_SEARCH.layout,
    ...(isWorkItemSortField(candidate.sort) ? { sort: candidate.sort } : {}),
    ...(isWorkItemSortDirection(candidate.dir) ? { dir: candidate.dir } : {}),
    ...(typeof candidate.filter === "string" &&
    candidate.filter.length > 0 &&
    candidate.filter.length <= WORK_ITEM_FILTER_URL_MAX_LENGTH &&
    ![...candidate.filter].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
      ? { filter: candidate.filter }
      : {}),
    ...(candidate.filterMode === "visual" || candidate.filterMode === "text"
      ? { filterMode: candidate.filterMode }
      : {}),
    ...(validColumns ? { columns: columns as WorkItemSearchColumn[] } : {}),
  };
}

/** The inverse direction, for a column-header sort toggle. */
export function toggleWorkItemSortDirection(
  dir: WorkItemSortDirection,
): WorkItemSortDirection {
  return dir === "asc" ? "desc" : "asc";
}

export const routes = {
  requestTypes: {
    path: "/agent/settings/request-types" as const,
    build: (search: RequestTypeEditorSearch = {}) => {
      const resolved = parseRequestTypeEditorSearch(search);
      return resolved.requestTypeId
        ? `/agent/settings/request-types?requestTypeId=${encodeURIComponent(resolved.requestTypeId)}`
        : "/agent/settings/request-types";
    },
  },
  /** `docs/02-design/screen-inventory.md` intake queue; filters and selected submission are URL state. */
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
    build: (params: { key: string }) =>
      `/agent/work-items/${encodeURIComponent(params.key)}`,
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
