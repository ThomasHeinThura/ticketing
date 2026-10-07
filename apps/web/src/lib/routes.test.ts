import { describe, expect, it, vi } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import {
  buildGeneratedRouteUrl,
  DEFAULT_WORK_ITEM_LIST_SEARCH,
  getInitialBoardRoutePreload,
  parseGeneratedRouteUrl,
  parseWorkItemListSearch,
  parseWorkItemListSearchFromQueryString,
  preloadInitialBoardRoute,
  routes,
  toggleWorkItemSortDirection,
  WORK_ITEM_SORT_DIRECTIONS,
  WORK_ITEM_SORT_FIELDS,
} from "./routes";

describe("routes.workItemList", () => {
  it("round-trips every sort field and direction through build -> parse", () => {
    for (const sort of WORK_ITEM_SORT_FIELDS) {
      for (const dir of WORK_ITEM_SORT_DIRECTIONS) {
        const url = routes.workItemList.build(
          { projectKey: "PROJ" },
          { sort, dir },
        );
        const [, queryString] = url.split("?");
        const parsed = parseWorkItemListSearchFromQueryString(queryString);
        expect(parsed).toEqual({ layout: "list", sort, dir });
      }
    }
  });

  it("builds the path the screen inventory names, with the project key in it", () => {
    const url = routes.workItemList.build({ projectKey: "PROJ" });
    expect(url.startsWith("/agent/projects/PROJ/work?")).toBe(true);
  });

  it("encodes a project key that needs escaping", () => {
    const url = routes.workItemList.build({ projectKey: "a/b c" });
    expect(url.startsWith("/agent/projects/a%2Fb%20c/work?")).toBe(true);
  });

  it("defaults to layout=list, sort=key, dir=asc when no search is given", () => {
    const url = routes.workItemList.build({ projectKey: "PROJ" });
    const [, queryString] = url.split("?");
    expect(parseWorkItemListSearchFromQueryString(queryString)).toEqual(
      DEFAULT_WORK_ITEM_LIST_SEARCH,
    );
  });

  it("survives a reload: parsing the exact query string build() produced is idempotent", () => {
    const url = routes.workItemList.build(
      { projectKey: "PROJ" },
      { sort: "dueDate", dir: "desc" },
    );
    const [, queryString] = url.split("?");
    const firstParse = parseWorkItemListSearchFromQueryString(queryString);
    const rebuilt = routes.workItemList.build(
      { projectKey: "PROJ" },
      firstParse,
    );
    expect(rebuilt).toBe(url);
  });

  describe("parseWorkItemListSearch", () => {
    it("falls back to the default for missing fields", () => {
      expect(parseWorkItemListSearch({})).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
      expect(parseWorkItemListSearch(undefined)).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
    });

    it("never throws on malformed input, and falls back per-field", () => {
      expect(
        parseWorkItemListSearch({
          layout: "board", // not built yet -- falls back to list
          sort: "not-a-real-field",
          dir: "sideways",
        }),
      ).toEqual(DEFAULT_WORK_ITEM_LIST_SEARCH);

      expect(
        parseWorkItemListSearch({ sort: "priority", dir: "desc" }),
      ).toEqual({ layout: "list", sort: "priority", dir: "desc" });

      // Non-object input (e.g. a bare string from a malformed bookmark).
      expect(parseWorkItemListSearch("garbage")).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
      expect(parseWorkItemListSearch(null)).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
    });
  });

  describe("toggleWorkItemSortDirection", () => {
    it("flips asc <-> desc", () => {
      expect(toggleWorkItemSortDirection("asc")).toBe("desc");
      expect(toggleWorkItemSortDirection("desc")).toBe("asc");
    });
  });
});

describe("initial board route preload hint", () => {
  it("matches only a complete direct board path and accepts the router trailing slash", () => {
    expect(
      getInitialBoardRoutePreload(
        "/dashboard/workspace/ws-1/project/pr-1/board",
        "",
      ),
    ).toEqual({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "ws-1", projectId: "pr-1" },
      search: {},
    });
    expect(
      getInitialBoardRoutePreload(
        "/dashboard/workspace/ws-1/project/pr-1/board/",
        "",
      ),
    ).toEqual(
      getInitialBoardRoutePreload(
        "/dashboard/workspace/ws-1/project/pr-1/board",
        "",
      ),
    );
    for (const pathname of [
      "/dashboard/workspace/ws-1/project/pr-1/board/task/42",
      "/dashboard/workspace/ws-1/project/pr-1/board-extra",
      "/dashboard/workspace/ws-1/project/pr-1/backlog",
      "/agent/projects/ws-1/work",
    ]) {
      expect(getInitialBoardRoutePreload(pathname, "")).toBeUndefined();
    }
  });

  it("decodes each path parameter once and retains board task selection state", () => {
    expect(
      getInitialBoardRoutePreload(
        "/dashboard/workspace/ws%2Fone/project/pr%20two/board",
        "?taskId=task%2F42&unrelated=ignored",
      ),
    ).toEqual({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "ws/one", projectId: "pr two" },
      search: { taskId: "task/42" },
    });
  });

  it("preserves an explicitly empty taskId and ignores malformed path encodings", () => {
    expect(
      getInitialBoardRoutePreload(
        "/dashboard/workspace/ws/project/pr/board",
        "?taskId=",
      )?.search,
    ).toEqual({ taskId: "" });
    expect(
      getInitialBoardRoutePreload(
        "/dashboard/workspace/ws%ZZ/project/pr/board",
        "?taskId=task-1",
      ),
    ).toBeUndefined();
  });

  it("calls only the matched router preload, without leaking query state", () => {
    const preloadRoute = vi.fn().mockResolvedValue(undefined);
    preloadInitialBoardRoute(
      "/dashboard/workspace/ws-1/project/pr-1/board",
      "?taskId=task-1&ignored=yes",
      preloadRoute,
    );
    expect(preloadRoute).toHaveBeenCalledExactlyOnceWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "ws-1", projectId: "pr-1" },
      search: { taskId: "task-1" },
    });
    preloadRoute.mockClear();
    preloadInitialBoardRoute(
      "/dashboard/workspace/ws-1/project/pr-1/board/extra",
      "?taskId=task-1",
      preloadRoute,
    );
    expect(preloadRoute).not.toHaveBeenCalled();
  });

  it("leaves synchronous and asynchronous speculative preload failures to router navigation", async () => {
    const rejectPreload = vi.fn().mockRejectedValue(new Error("chunk failure"));
    expect(() =>
      preloadInitialBoardRoute(
        "/dashboard/workspace/ws/project/pr/board",
        "",
        rejectPreload,
      ),
    ).not.toThrow();
    await Promise.resolve();

    const throwPreload = vi.fn(() => {
      throw new Error("router preload failure");
    });
    expect(() =>
      preloadInitialBoardRoute(
        "/dashboard/workspace/ws/project/pr/board",
        "",
        throwPreload,
      ),
    ).not.toThrow();
  });
});

describe("G5 route metadata", () => {
  it("keeps agent and portal routes sourced from their independent generated trees", () => {
    expect(generatedRouteMetadata.agent).toContain(
      "/agent/projects/$projectKey/work",
    );
    expect(generatedRouteMetadata.portal).toEqual(["/"]);
  });

  it("round-trips the portal root URL through its route helper", () => {
    const url = new URL(
      routes.portalHome.build(),
      "https://portal.example.test",
    );
    expect(routes.portalHome.parse(url.pathname)).toBe(
      routes.portalHome.build(),
    );
    expect(routes.portalHome.parse("/unmatched")).toBeUndefined();
  });

  it("builds and parses every generated agent and portal route template", () => {
    for (const surface of ["agent", "portal"] as const) {
      for (const template of generatedRouteMetadata[surface]) {
        const names = [...template.matchAll(/\$([A-Za-z0-9_]+)/gu)].map(
          (match) => match[1],
        );
        const params = Object.fromEntries(
          names.map((name) => [name, `value/${name} part`]),
        );
        const url = buildGeneratedRouteUrl(surface, template, params);
        expect(parseGeneratedRouteUrl(surface, template, url)).toEqual({
          pathname: url,
          params,
        });
      }
    }
  });
});

describe("routes.workItemDetail", () => {
  it("builds the future detail path with the work item key", () => {
    expect(routes.workItemDetail.build({ key: "PROJ-123" })).toBe(
      "/agent/work-items/PROJ-123",
    );
  });

  it("encodes a key that needs escaping", () => {
    expect(routes.workItemDetail.build({ key: "a/b" })).toBe(
      "/agent/work-items/a%2Fb",
    );
  });
});
