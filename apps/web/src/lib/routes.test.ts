import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import { projectViewRoutes } from "./project-view-routes";
import {
  buildGeneratedRouteUrl,
  DEFAULT_WORK_ITEM_LIST_SEARCH,
  parseGeneratedRouteUrl,
  parseIdentityConnectionEventsSearch,
  parseIdentityConnectionEventsSearchFromQueryString,
  parseMyWorkSearch,
  parsePendingActionsSearch,
  parseSavedViewsSearch,
  parseSavedViewUrlSearchFromQueryString,
  parseServiceCalendarListSearchFromQueryString,
  parseSlaPolicyListSearch,
  parseWorkItemDetailSearch,
  parseWorkItemListSearch,
  parseWorkItemListSearchFromQueryString,
  resolveWorkItemListSort,
  routes,
  type SavedViewUrlSearch,
  toggleWorkItemSortDirection,
  WORK_ITEM_SORT_DIRECTIONS,
  WORK_ITEM_SORT_FIELDS,
} from "./routes";
import { parseCalendarEditorSearch } from "./service-calendar-form";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
} from "./work-item-filter";

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

  it("defaults only the built list layout when no search is given", () => {
    const url = routes.workItemList.build({ projectKey: "PROJ" });
    const [, queryString] = url.split("?");
    expect(parseWorkItemListSearchFromQueryString(queryString)).toEqual(
      DEFAULT_WORK_ITEM_LIST_SEARCH,
    );
  });

  it.each([
    [{}, "key", "asc", undefined],
    [
      { sort: "priority" },
      "priority",
      "asc",
      [{ field: "priority", order: "asc" }],
    ],
    [{ dir: "desc" }, "key", "desc", [{ field: "key", order: "desc" }]],
    [
      { sort: "dueDate", dir: "desc" },
      "dueDate",
      "desc",
      [{ field: "dueDate", order: "desc" }],
    ],
  ] as const)(
    "uses one effective list sort for display and search for %o",
    (search, field, order, querySort) => {
      expect(resolveWorkItemListSort(search)).toEqual({
        field,
        order,
        querySort,
      });
    },
  );

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

  it("round-trips bounded filter text while preserving unrelated URL state", () => {
    const url = routes.workItemList.build(
      { projectKey: "PROJ" },
      {
        filter: 'state:in(started,completed) OR title:"needs review"',
        sort: "priority",
        dir: "desc",
      },
    );
    const [, queryString] = url.split("?");
    expect(parseWorkItemListSearchFromQueryString(queryString)).toEqual({
      layout: "list",
      sort: "priority",
      dir: "desc",
      filter: 'state:in(started,completed) OR title:"needs review"',
    });
  });

  it("round-trips editor mode and explicit empty columns without adding absent sort state", () => {
    const search = {
      filter: "assignee:@me",
      filterMode: "text" as const,
      columns: [],
    };
    const url = routes.workItemList.build({ projectKey: "PROJ" }, search);
    const [, queryString] = url.split("?");
    const parsed = parseWorkItemListSearchFromQueryString(queryString);
    expect(parsed).toEqual({ layout: "list", ...search });
    expect(parsed).not.toHaveProperty("sort");
    expect(parsed).not.toHaveProperty("dir");
    expect(routes.workItemList.build({ projectKey: "PROJ" }, parsed)).toBe(url);
  });

  it("keeps the work-list filter state when navigating to another project key", () => {
    const search = {
      filter: "due:<7d AND assignee:@me",
      filterMode: "visual" as const,
      sort: "priority" as const,
      dir: "desc" as const,
      columns: ["key", "priority"] as ("key" | "priority")[],
    };
    const first = routes.workItemList.build({ projectKey: "OPS" }, search);
    const second = routes.workItemList.build({ projectKey: "APP" }, search);
    expect(first.replace("OPS", "APP")).toBe(second);
    expect(
      parseWorkItemListSearchFromQueryString(second.split("?")[1]),
    ).toEqual({
      layout: "list",
      ...search,
    });
  });

  it("parses nested text filters to the endpoint AST", () => {
    expect(
      parseWorkItemFilterText(
        "state:in(started,completed) OR (assignee:@me AND due:<7d)",
      ),
    ).toEqual({
      op: "or",
      clauses: [
        { field: "state.group", op: "in", value: ["started", "completed"] },
        {
          op: "and",
          clauses: [
            { field: "assignee", op: "eq", value: "@me" },
            { field: "dueDate", op: "lt", value: "7d" },
          ],
        },
      ],
    });
  });

  it("SV-11: prints and reparses nested groups, @me, and relative date values losslessly", () => {
    const ast = parseWorkItemFilterText(
      "(state:in(started,completed) OR (assignee:@me AND due:>=7d)) AND created:>2026-01-01",
    );
    const printed = printWorkItemFilterText(ast);
    expect(parseWorkItemFilterText(printed)).toEqual(ast);
    expect(printed).toContain("assignee:@me");
    expect(printed).toContain("due:>=7d");
  });

  it("SV-11: preserves an explicit single-child nested group", () => {
    const ast = {
      op: "or" as const,
      clauses: [
        {
          op: "and" as const,
          clauses: [{ field: "assignee", op: "eq", value: "@me" }],
        },
        { field: "priority", op: "eq", value: "high" },
      ],
    };
    expect(parseWorkItemFilterText(printWorkItemFilterText(ast))).toEqual(ast);
  });

  it("SV-11: rejects text that would silently lose a contains argument", () => {
    expect(() =>
      parseWorkItemFilterText("watcher:contains(@me,other)"),
    ).toThrow("The contains operator requires one value.");
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
      expect(parseWorkItemListSearch({ filter: "bad\nfilter" })).toEqual(
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

describe("projectViewRoutes.projectBoard, projectCalendar and projectBacklog", () => {
  const params = { workspaceId: "workspace/a b", projectId: "project?one" };

  it("round-trips the complete shared project view state through every canonical view", () => {
    const search = {
      taskId: "task/selected",
      layout: "list" as const,
      month: "2026-10",
      q: "urgent follow-up",
      sort: "priority" as const,
      dir: "desc" as const,
      status: ["todo", "inProgress"],
      priority: ["high"],
      assignee: ["user-1", "user-2"],
      dueDate: ["dueThisWeek"],
      labels: ["label-1", "label-2"],
    };
    const canonicalRoutes = [
      projectViewRoutes.projectBacklog,
      projectViewRoutes.projectBoard,
      projectViewRoutes.projectCalendar,
      projectViewRoutes.projectGantt,
    ];

    for (const route of canonicalRoutes) {
      const url = route.build(params, search);
      expect(route.parse(url)).toEqual({ params, search });
    }
  });

  it("round-trips escaped workspace/project params and explicit/default/invalid board state", () => {
    const url = projectViewRoutes.projectBoard.build(params, {
      layout: "list",
      taskId: "task/one?two",
    });
    expect(url).toBe(
      "/dashboard/workspace/workspace%2Fa%20b/project/project%3Fone/board?layout=list&taskId=task%2Fone%3Ftwo",
    );
    expect(projectViewRoutes.projectBoard.parse(url)).toEqual({
      params,
      search: { layout: "list", taskId: "task/one?two" },
    });
    expect(
      projectViewRoutes.projectBoard.parse(
        projectViewRoutes.projectBoard.build(params),
      ),
    ).toEqual({ params, search: {} });
    expect(
      projectViewRoutes.projectBoard.parse(
        `${projectViewRoutes.projectBoard.build(params)}?layout=calendar&taskId=`,
      ),
    ).toEqual({ params, search: {} });
    expect(generatedRouteMetadata.agent).toContain(
      projectViewRoutes.projectBoard.path,
    );
  });

  it("round-trips calendar month and task state, including invalid/default query values", () => {
    const url = projectViewRoutes.projectCalendar.build(params, {
      month: "2026-10",
      taskId: "task/a b",
    });
    expect(url).toBe(
      "/dashboard/workspace/workspace%2Fa%20b/project/project%3Fone/calendar?taskId=task%2Fa+b&month=2026-10",
    );
    expect(projectViewRoutes.projectCalendar.parse(url)).toEqual({
      params,
      search: { month: "2026-10", taskId: "task/a b" },
    });
    expect(
      projectViewRoutes.projectCalendar.parse(
        projectViewRoutes.projectCalendar.build(params),
      ),
    ).toEqual({ params, search: {} });
    expect(
      projectViewRoutes.projectCalendar.parse(
        `${projectViewRoutes.projectCalendar.build(params)}?month=2026-13&taskId=task-1`,
      ),
    ).toEqual({ params, search: { taskId: "task-1" } });
    expect(generatedRouteMetadata.agent).toContain(
      projectViewRoutes.projectCalendar.path,
    );
  });

  it("round-trips task panel and shortcut/history transitions through registered route URLs", () => {
    const backlogUrl = projectViewRoutes.projectBacklog.build(params, {
      taskId: "task/backlog",
    });
    const listUrl = projectViewRoutes.projectBoard.build(params, {
      layout: "list",
    });
    const boardUrl = projectViewRoutes.projectBoard.build(params, {
      layout: "board",
    });
    const calendarUrl = projectViewRoutes.projectCalendar.build(params, {
      month: "2026-10",
    });
    const calendarTaskUrl = projectViewRoutes.projectCalendar.build(params, {
      month: "2026-10",
      taskId: "task/calendar",
    });
    const boardTaskUrl = projectViewRoutes.projectBoard.build(params, {
      layout: "list",
      taskId: "task/shared",
    });
    const otherProjectParams = { ...params, projectId: "project two" };
    const otherProjectUrl =
      projectViewRoutes.projectBoard.build(otherProjectParams);
    const calendarFromBoardShortcut = projectViewRoutes.projectCalendar.build(
      params,
      {
        taskId:
          projectViewRoutes.projectBoard.parse(boardTaskUrl)?.search.taskId,
      },
    );
    const boardFromCalendarShortcut = projectViewRoutes.projectBoard.build(
      params,
      {
        layout: "board",
        taskId:
          projectViewRoutes.projectCalendar.parse(calendarTaskUrl)?.search
            .taskId,
      },
    );
    const boardFromBacklogShortcut = projectViewRoutes.projectBoard.build(
      params,
      {
        layout: "list",
        taskId:
          projectViewRoutes.projectBacklog.parse(backlogUrl)?.search.taskId,
      },
    );
    const calendarFromBacklogShortcut = projectViewRoutes.projectCalendar.build(
      params,
      {
        taskId:
          projectViewRoutes.projectBacklog.parse(backlogUrl)?.search.taskId,
      },
    );

    expect(projectViewRoutes.projectBacklog.parse(backlogUrl)).toEqual({
      params,
      search: { taskId: "task/backlog" },
    });
    expect(projectViewRoutes.projectBoard.parse(listUrl)?.search).toEqual({
      layout: "list",
    });
    expect(projectViewRoutes.projectBoard.parse(boardUrl)?.search).toEqual({
      layout: "board",
    });
    expect(
      projectViewRoutes.projectCalendar.parse(calendarTaskUrl)?.search,
    ).toEqual({
      month: "2026-10",
      taskId: "task/calendar",
    });
    expect(
      projectViewRoutes.projectCalendar.parse(calendarFromBoardShortcut)
        ?.search,
    ).toEqual({ taskId: "task/shared" });
    expect(
      projectViewRoutes.projectBoard.parse(boardFromCalendarShortcut)?.search,
    ).toEqual({
      layout: "board",
      taskId: "task/calendar",
    });
    expect(
      projectViewRoutes.projectBoard.parse(boardFromBacklogShortcut)?.search,
    ).toEqual({
      layout: "list",
      taskId: "task/backlog",
    });
    expect(
      projectViewRoutes.projectCalendar.parse(calendarFromBacklogShortcut)
        ?.search,
    ).toEqual({ taskId: "task/backlog" });

    // The route URLs used by calendar/backlog shortcuts and browser history
    // are independently parseable, and calendar task open/close retains month.
    expect(
      [listUrl, calendarUrl, boardUrl].map(
        (url) =>
          projectViewRoutes.projectBoard.parse(url)?.search.layout ??
          projectViewRoutes.projectCalendar.parse(url)?.search.month,
      ),
    ).toEqual(["list", "2026-10", "board"]);
    expect(
      projectViewRoutes.projectCalendar.build(params, {
        ...projectViewRoutes.projectCalendar.parse(calendarTaskUrl)?.search,
        taskId: undefined,
      }),
    ).toBe(calendarUrl);
    expect(
      projectViewRoutes.projectBoard.build(params, {
        ...projectViewRoutes.projectBoard.parse(boardTaskUrl)?.search,
        taskId: undefined,
      }),
    ).toBe(listUrl);

    const browserHistory = [listUrl, boardUrl, otherProjectUrl].map((url) =>
      projectViewRoutes.projectBoard.parse(url),
    );
    expect(
      browserHistory.map((entry) => [
        entry?.params.projectId,
        entry?.search.layout ?? "profile-default",
      ]),
    ).toEqual([
      [params.projectId, "list"],
      [params.projectId, "board"],
      [otherProjectParams.projectId, "profile-default"],
    ]);
  });
});

describe("routes.savedView", () => {
  it("SV-19: round-trips full query and presentation state in a shareable URL", () => {
    const search = {
      workspaceId: "workspace/one",
      scope: "project" as const,
      scopeId: "project one",
      layout: "list",
      filter: "AND(state:started,priority:in(high,urgent))",
      filterMode: "text" as const,
      sort: "priority" as const,
      dir: "desc" as const,
      columns: ["key", "title", "priority"],
    } satisfies SavedViewUrlSearch;
    const url = routes.savedView.build({ id: "view/one" }, search);
    const parsed = parseSavedViewUrlSearchFromQueryString(
      url.split("?")[1] ?? "",
    );
    expect(url).toContain("/agent/views/view%2Fone?");
    expect(parsed).toEqual({ ...search, columns: [...search.columns] });
  });
});

describe("routes.myWork", () => {
  it("keeps the approvals lens in the URL across a reload", () => {
    const url = routes.myWork.build({ lens: "approvals" });
    expect(url).toBe("/agent/my-work?lens=approvals");
    expect(
      parseMyWorkSearch({
        lens: new URL(url, "https://app.test").searchParams.get("lens"),
      }),
    ).toEqual({ lens: "approvals" });
  });
});

describe("G5 route metadata", () => {
  it("keeps agent and portal routes sourced from their independent generated trees", () => {
    expect(generatedRouteMetadata.agent).toContain(
      "/agent/projects/$projectKey/work",
    );
    expect(generatedRouteMetadata.portal).toEqual([
      "/",
      "/approvals",
      "/sign-in",
    ]);
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

  it("round-trips the portal approvals URL", () => {
    const url = routes.portalApprovals.build();
    expect(url).toBe("/portal/approvals");
    expect(routes.portalApprovals.parse(url)).toBe(url);
    expect(routes.portalApprovals.parse("/portal/other")).toBeUndefined();
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

describe("pending action URLs", () => {
  it("keeps list pagination in the URL and builds the approval path", () => {
    expect(routes.pendingActions.build({ cursor: "next/page" })).toBe(
      "/agent/settings/profile/pending-actions?cursor=next%2Fpage",
    );
    expect(parsePendingActionsSearch({ cursor: "next/page" })).toEqual({
      cursor: "next/page",
    });
    expect(parsePendingActionsSearch({ cursor: "" })).toEqual({});
    expect(routes.pendingAction.build({ id: "action/one" })).toBe(
      "/agent/settings/profile/pending-actions/action%2Fone",
    );
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

  it("round-trips a valid activity filter and discards invalid URL state", () => {
    const url = routes.workItemDetail.build(
      { key: "PROJ-123" },
      { activity: "public" },
    );
    expect(url).toBe("/agent/work-items/PROJ-123?activity=public");
    expect(parseWorkItemDetailSearch({ activity: "public" })).toEqual({
      activity: "public",
    });
    expect(parseWorkItemDetailSearch({ activity: "invalid" })).toEqual({});
  });
});

describe("routes.serviceCalendars", () => {
  it("builds the list route named by the screen inventory", () => {
    expect(routes.serviceCalendars.build()).toBe("/agent/settings/calendars");
  });

  it("round-trips one opaque cursor through URL encoding without page history", () => {
    const search = { cursor: "cursor/a+b?=" };
    const url = routes.serviceCalendars.build(search);
    expect(
      parseServiceCalendarListSearchFromQueryString(url.split("?")[1] ?? ""),
    ).toEqual(search);
    expect(url).not.toContain("history=");
  });

  it("preserves the editor id and preview year in its URL", () => {
    const url = routes.serviceCalendarEditor.build({ id: "cal/one" }, 2026);
    expect(url).toBe("/agent/settings/calendars/cal%2Fone?year=2026");
    expect(
      parseCalendarEditorSearch({
        year: new URL(url, "https://taskdesk.invalid").searchParams.get("year"),
      }),
    ).toEqual({ year: 2026 });
  });

  it("does not add search state when the year is not supplied", () => {
    expect(routes.serviceCalendarEditor.build({ id: "new" })).toBe(
      "/agent/settings/calendars/new",
    );
  });
});

describe("routes.savedViews", () => {
  it("round-trips view filtering in the URL and bounds untrusted query text", () => {
    const url = routes.savedViews.build({ query: "  my / view  " });
    expect(url).toBe("/agent/views?query=my+%2F+view");
    expect(
      parseSavedViewsSearch({
        query: new URL(url, "https://taskdesk.invalid").searchParams.get(
          "query",
        ),
      }),
    ).toEqual({ query: "my / view" });
    expect(
      parseSavedViewsSearch({ query: "x".repeat(201) }).query,
    ).toHaveLength(200);
    expect(generatedRouteMetadata.agent).toContain(routes.savedViews.path);
  });
});

describe("routes.slaPolicies", () => {
  it("round-trips the list cursor and editor id through registered route builders", () => {
    const url = routes.slaPolicies.build({ cursor: "opaque/a+b" });
    expect(url).toBe("/agent/settings/sla-policies?cursor=opaque%2Fa%2Bb");
    expect(
      parseSlaPolicyListSearch({
        cursor: new URL(url, "https://taskdesk.invalid").searchParams.get(
          "cursor",
        ),
      }),
    ).toEqual({ cursor: "opaque/a+b" });
    expect(routes.slaPolicyEditor.build({ id: "policy/one" })).toBe(
      "/agent/settings/sla-policies/policy%2Fone",
    );
  });
});

describe("routes.identityConnections", () => {
  it("keeps the God Mode list, create form and connection editor directly addressable", () => {
    expect(routes.identityConnections.build()).toBe("/god-mode/authentication");
    expect(routes.identityConnectionCreate.build()).toBe(
      "/god-mode/authentication/new",
    );
    expect(
      routes.identityConnectionSettings.build({ id: "connection/a" }),
    ).toBe("/god-mode/authentication/connection%2Fa");
    const eventUrl = routes.identityConnectionSettings.build(
      { id: "connection/a" },
      { eventsCursor: "opaque/a+b" },
    );
    expect(eventUrl).toBe(
      "/god-mode/authentication/connection%2Fa?eventsCursor=opaque%2Fa%2Bb",
    );
    expect(
      parseIdentityConnectionEventsSearchFromQueryString(
        eventUrl.split("?")[1] ?? "",
      ),
    ).toEqual({ eventsCursor: "opaque/a+b" });
    expect(
      parseIdentityConnectionEventsSearch({ eventsCursor: "x".repeat(513) }),
    ).toEqual({ eventsCursor: undefined });
    expect(generatedRouteMetadata.agent).toContain(
      routes.identityConnections.path,
    );
    expect(generatedRouteMetadata.agent).toContain(
      routes.identityConnectionSettings.path,
    );
  });
});
