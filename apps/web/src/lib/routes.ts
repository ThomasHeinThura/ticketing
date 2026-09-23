// Canonical route registry (AGENTS.md rule 4): every v2 ("agent") screen has a URL, and
// any filter/sort state it carries lives in the query string so a reload reproduces it
// exactly. This is the FIRST entry in this registry -- v2 has exactly one screen so far,
// the work-item list (issue #23, decision log "2026-09-23 · P1's UI path").
//
// `docs/02-design/ux-quality-gates.md` G5 describes a FUTURE state where this file is
// generated from the router's own route trees (`routeTree.agent.gen.ts` /
// `routeTree.portal.gen.ts`) and diffed against the screen inventory by `check:inventory`.
// Neither exists yet: there is no agent/portal router split (G12's own two-router-tree
// requirement is still open, tracked as P0 infrastructure), so today there is one router
// tree (`routeTree.gen.ts`) and no generator/checker script. This file is hand-authored
// until that lands, and kept honest in the meantime by the round-trip test in
// `routes.test.ts`: every URL this file can build, `parseWorkItemListSearch` can parse
// back to the exact params/search that built it, and malformed input recovers to a
// default rather than throwing.

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
   * `/agent/work-items/{key}` -- not built yet (P1, ⬜). This lane's list rows link here
   * as their row-open destination, per this lane's own instructions ("that can be the
   * future detail path, as long as it's registered"). Resolves today to a stub route
   * (`routes/.../agent/work-items/$key.tsx`) that says the full page isn't built, not a
   * 404 -- the URL contract will not need to change once the real page lands.
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
