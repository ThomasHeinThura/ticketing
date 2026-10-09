import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  appendProjectViewSearchParams,
  parseProjectBacklogSearch,
  parseProjectBoardSearch,
  parseProjectRouterSearch,
  parseProjectViewSearchFromParams,
} from "./project-board-search";
import {
  resolveProjectBoardLayout,
  withProjectBoardLayout,
  withProjectBoardTask,
} from "./project-board-search-state";
import { projectViewRoutes } from "./project-view-routes";

describe("project board URL state", () => {
  it("preserves string search through the registered TanStack URL codec", () => {
    for (const query of [
      "?q=123",
      "?q=true",
      "?q=false",
      "?q=1e3",
      "?q=null",
    ]) {
      const decoded = parseProjectRouterSearch(query);
      expect(parseProjectBoardSearch(decoded)).toEqual({
        q: new URLSearchParams(query).get("q"),
      });
    }
    expect(
      parseProjectBoardSearch(parseProjectRouterSearch("?q=%22123%22")),
    ).toEqual({ q: "123" });
    expect(
      parseProjectBoardSearch(parseProjectRouterSearch("?q=%5B1%5D")),
    ).toEqual({});
    expect(
      parseProjectBoardSearch(
        parseProjectRouterSearch("?q=%7B%22term%22%3A%22x%22%7D"),
      ),
    ).toEqual({});
    expect(
      parseProjectBoardSearch(
        parseProjectRouterSearch("?q=first&q=123&status=1&status=true"),
      ),
    ).toEqual({ q: "123", status: ["1", "true"] });
  });

  it("round-trips numeric-like text through router, keyboard links, and history URLs", () => {
    const search = {
      q: "123",
      taskId: "123",
      status: ["true", "456"],
      labels: ["a & b"],
    };
    const routerUrl = defaultStringifySearch(search);
    expect(
      parseProjectBoardSearch(parseProjectRouterSearch(routerUrl)),
    ).toEqual(search);

    const keyboardUrl = projectViewRoutes.projectBoard.build(
      { workspaceId: "workspace-1", projectId: "project-1" },
      search,
    );
    const keyboardSearch = new URL(keyboardUrl, "https://taskdesk.test");
    expect(
      parseProjectBoardSearch(parseProjectRouterSearch(keyboardSearch.search)),
    ).toEqual(search);
    const historyUrl = `${keyboardSearch.pathname}${keyboardSearch.search}`;
    expect(
      parseProjectBoardSearch(
        parseProjectRouterSearch(
          new URL(historyUrl, "https://taskdesk.test").search,
        ),
      ),
    ).toEqual(search);
  });

  it("keeps JSON-like text as strings in router and keyboard-built URLs", () => {
    const values = [
      "null",
      "[]",
      '{"a":1}',
      '"quoted"',
      "123",
      "true",
      "a & b",
    ];
    for (const q of values) {
      const expected = { q, labels: [q] };
      expect(
        parseProjectBoardSearch(
          parseProjectRouterSearch(defaultStringifySearch(expected)),
        ),
      ).toEqual(expected);

      const keyboardUrl = projectViewRoutes.projectBoard.build(
        { workspaceId: "workspace-1", projectId: "project-1" },
        expected,
      );
      const url = new URL(keyboardUrl, "https://taskdesk.test");
      expect(
        parseProjectBoardSearch(parseProjectRouterSearch(url.search)),
      ).toEqual(expected);
    }
    expect(
      parseProjectBoardSearch(parseProjectRouterSearch("?q=%22%5B1%5D%22")),
    ).toEqual({ q: "[1]" });
  });

  it("keeps numeric-like search through a registered router deep link and history", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/?q=123&status=1&status=true"],
    });
    const routeTree = createRootRoute({
      validateSearch: parseProjectBoardSearch,
    });
    const router = createRouter({
      routeTree,
      history,
      parseSearch: parseProjectRouterSearch,
      stringifySearch: defaultStringifySearch,
    });
    await router.load();
    expect(router.state.location.search).toEqual({
      q: "123",
      status: ["1", "true"],
    });

    for (const q of ["null", "[]", '{"a":1}', '"quoted"', "123", "true"]) {
      await router.navigate({
        to: "/",
        search: { q, status: [q] },
      });
      expect(router.state.location.search).toEqual({ q, status: [q] });
    }
    for (const _ of ["null", "[]", '{"a":1}', '"quoted"', "123", "true"])
      router.history.back();
    await router.load();
    expect(router.state.location.search).toEqual({
      q: "123",
      status: ["1", "true"],
    });
  });

  it("keeps generic month values for non-calendar views", () => {
    expect(parseProjectBoardSearch({ month: "2026-13" }).month).toBe("2026-13");
  });

  it("accepts board/list layouts and drops unknown layout values", () => {
    expect(
      parseProjectBoardSearch({ layout: "list", taskId: "task-1" }),
    ).toEqual({
      layout: "list",
      taskId: "task-1",
    });
    expect(parseProjectBoardSearch({ layout: "calendar" })).toEqual({});
    expect(resolveProjectBoardLayout("list", "board")).toBe("list");
    expect(resolveProjectBoardLayout(undefined, "list")).toBe("list");
  });

  it("keeps the existing accepted and rejected URL values stable", () => {
    expect(
      parseProjectBoardSearch({
        taskId: "task/one",
        q: "  deploy & verify  ",
        month: "2026-11",
        sort: "priority",
        dir: "desc",
        status: ["todo", "", 3, "todo", "doing"],
        dueDate: ["dueThisWeek", "unknown", "constructor", "noDueDate"],
        labels: "label-1",
        layout: "list",
        unknown: "discarded",
      }),
    ).toEqual({
      taskId: "task/one",
      q: "  deploy & verify  ",
      month: "2026-11",
      sort: "priority",
      dir: "desc",
      status: ["todo", "doing"],
      dueDate: ["dueThisWeek", "noDueDate"],
      labels: ["label-1"],
      layout: "list",
    });
    expect(
      parseProjectBacklogSearch({
        taskId: "",
        q: 7,
        sort: "arbitrary",
        dir: "sideways",
        status: ["", null, false],
        priority: [],
        dueDate: "unknown",
        layout: "calendar",
        extra: "discarded",
      }),
    ).toEqual({});
  });

  it("round-trips repeated filters and escaped scalar URL state", () => {
    const expected = {
      taskId: "task/one",
      q: "deploy & verify",
      status: ["todo", "doing"],
      labels: ["label-1", "label/2"],
      layout: "list" as const,
      sort: "title" as const,
      dir: "asc" as const,
    };
    const params = new URLSearchParams();
    appendProjectViewSearchParams(params, expected);
    expect(parseProjectViewSearchFromParams(params)).toEqual(expected);
    expect(params.toString()).toBe(
      "layout=list&taskId=task%2Fone&q=deploy+%26+verify&sort=title&dir=asc&status=todo&status=doing&labels=label-1&labels=label%2F2",
    );
  });

  it("keeps last scalar and ordered unique filter values from repeated query keys", () => {
    const params = new URLSearchParams(
      "q=first&q=last&status=todo&status=todo&status=doing&unknown=one&unknown=two",
    );
    expect(parseProjectViewSearchFromParams(params)).toEqual({
      q: "last",
      status: ["todo", "doing"],
    });
  });

  it("keeps the selected task when layout changes and keeps layout when task selection changes", () => {
    const current = { taskId: "task-1", layout: "board" as const };
    expect(withProjectBoardLayout(current, "list")).toEqual({
      taskId: "task-1",
      layout: "list",
    });
    expect(withProjectBoardTask(current, "task-2")).toEqual({
      taskId: "task-2",
      layout: "board",
    });
    expect(withProjectBoardTask(current, undefined)).toEqual({
      layout: "board",
    });
  });

  it("keeps explicit layout choices isolated from the profile default across projects and history", () => {
    const profileDefault = "board" as const;
    const projectAList = parseProjectBoardSearch({ layout: "list" });
    const projectBDefault = parseProjectBoardSearch({});

    expect(resolveProjectBoardLayout(projectAList.layout, profileDefault)).toBe(
      "list",
    );
    expect(
      resolveProjectBoardLayout(projectBDefault.layout, profileDefault),
    ).toBe("board");

    // Back/forward restores each URL's own layout; clearing a URL falls back
    // to the unchanged profile default instead of persisting another project's choice.
    const history = [
      parseProjectBoardSearch({ layout: "board" }),
      projectAList,
      projectBDefault,
    ];
    expect(
      history.map(({ layout }) =>
        resolveProjectBoardLayout(layout, profileDefault),
      ),
    ).toEqual(["board", "list", "board"]);
  });

  it("preserves the current project's layout while a task panel opens and closes", () => {
    const projectA = parseProjectBoardSearch({ layout: "list" });
    const opened = withProjectBoardTask(projectA, "task-1");
    const closed = withProjectBoardTask(opened, undefined);

    expect(opened).toEqual({ layout: "list", taskId: "task-1" });
    expect(closed).toEqual({ layout: "list" });
    expect(
      resolveProjectBoardLayout(parseProjectBoardSearch({}).layout, "board"),
    ).toBe("board");
  });
});
