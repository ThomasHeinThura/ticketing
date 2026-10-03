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
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
};

export type ServiceCalendarListSearch = { cursor?: string };

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
  sort: "key",
  dir: "asc",
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
  return {
    layout: isWorkItemListLayout(candidate.layout)
      ? candidate.layout
      : DEFAULT_WORK_ITEM_LIST_SEARCH.layout,
    sort: isWorkItemSortField(candidate.sort)
      ? candidate.sort
      : DEFAULT_WORK_ITEM_LIST_SEARCH.sort,
    dir: isWorkItemSortDirection(candidate.dir)
      ? candidate.dir
      : DEFAULT_WORK_ITEM_LIST_SEARCH.dir,
  };
}

/** The inverse direction, for a column-header sort toggle. */
export function toggleWorkItemSortDirection(
  dir: WorkItemSortDirection,
): WorkItemSortDirection {
  return dir === "asc" ? "desc" : "asc";
}

export const routes = {
  /** Customer portal's P0 disabled landing page, rooted on its separate origin. */
  portalHome: {
    path: "/" as const,
    build: () => "/",
    parse: (pathname: string) => (pathname === "/" ? "/" : undefined),
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
};

/** The inverse of `routes.workItemList.build`'s query string, for the round-trip test. */
export function parseWorkItemListSearchFromQueryString(
  queryString: string,
): WorkItemListSearch {
  const params = new URLSearchParams(queryString);
  return parseWorkItemListSearch({
    layout: params.get("layout") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
  });
}
