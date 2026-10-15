import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import { projectViewRoutes } from "./project-view-routes";
import {
  buildGeneratedRouteUrl,
  DEFAULT_WORK_ITEM_LIST_SEARCH,
  parseGeneratedRouteUrl,
  parseGodModeUsersSearch,
  parseIntakeSearch,
  parsePendingActionsSearch,
  parsePendingActionsSearchFromQueryString,
  parsePortalCatalogueSearch,
  parsePortalSignInSearch,
  parseRequestTypeEditorSearch,
  parseSavedViewsSearch,
  parseSavedViewUrlSearch,
  parseSavedViewUrlSearchFromQueryString,
  parseServiceCalendarListSearchFromQueryString,
  parseSlaPolicyListSearch,
  parseWorkItemDetailSearch,
  parseWorkItemListSearch,
  parseWorkItemListSearchFromQueryString,
  routes,
  type SavedViewUrlSearch,
  toggleWorkItemSortDirection,
  WORK_ITEM_SORT_DIRECTIONS,
  WORK_ITEM_SORT_FIELDS,
} from "./routes";
import { parseCalendarEditorSearch } from "./service-calendar-form";

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

  it("round-trips the board layout and keeps sort=position", () => {
    const url = routes.workItemList.build(
      { projectKey: "PROJ" },
      { layout: "board", sort: "position", dir: "asc" },
    );
    expect(url).toContain("layout=board");
    expect(url).toContain("sort=position");
    const [, queryString] = url.split("?");
    expect(parseWorkItemListSearchFromQueryString(queryString)).toEqual({
      layout: "board",
      sort: "position",
      dir: "asc",
    });
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
          layout: "table", // not built yet -- falls back to list
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

describe("G5 route metadata", () => {
  it("keeps agent and portal routes sourced from their independent generated trees", () => {
    expect(generatedRouteMetadata.agent).toContain(
      "/agent/projects/$projectKey/work",
    );
    expect(generatedRouteMetadata.agent).toContain(
      "/agent/settings/request-types",
    );
    expect(generatedRouteMetadata.agent).toContain("/agent/triage");
    expect(generatedRouteMetadata.portal).toContain("/catalogue");
    expect(generatedRouteMetadata.portal).toContain("/sign-in");
    expect(generatedRouteMetadata.portal).toContain("/submissions/$ref");
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

  it("round-trips the activity filter and drops invalid values", () => {
    expect(
      routes.workItemDetail.build({ key: "PROJ-123" }, { activity: "public" }),
    ).toBe("/agent/work-items/PROJ-123?activity=public");
    expect(parseWorkItemDetailSearch({ activity: "comments" })).toEqual({
      activity: "comments",
    });
    expect(parseWorkItemDetailSearch({ activity: "unknown" })).toEqual({});
  });
});

describe("canonical intake URLs", () => {
  it("round-trips queue filters and selected submission through the URL", () => {
    const url = routes.intakeQueue.build({
      state: "clarifying",
      ref: "SUB-12",
    });
    const search = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    const parsed = parseIntakeSearch(search);
    expect(parsed).toEqual({ state: "clarifying", ref: "SUB-12" });
    expect(routes.intakeQueue.build(parsed)).toBe(url);
  });

  it("round-trips request type selection through the editor URL", () => {
    const url = routes.requestTypes.build({ requestTypeId: "type/with space" });
    const search = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    const parsed = parseRequestTypeEditorSearch(search);
    expect(parsed).toEqual({ requestTypeId: "type/with space" });
    expect(routes.requestTypes.build(parsed)).toBe(url);
  });

  it("round-trips catalogue search and selected type through its URL", () => {
    const url = routes.portalCatalogue.build({
      q: "hardware help",
      key: "printer",
    });
    const search = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    const parsed = parsePortalCatalogueSearch(search);
    expect(parsed).toEqual({ q: "hardware help", key: "printer" });
    expect(routes.portalCatalogue.build(parsed)).toBe(url);
  });

  it("round-trips sign-in stage and factor choice without placing credentials in the URL", () => {
    const url = routes.portalSignIn.build({
      stage: "factor",
      factor: "backup",
    });
    const search = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    expect(parsePortalSignInSearch(search)).toEqual({
      stage: "factor",
      factor: "backup",
    });
    expect(routes.portalSignIn.build(parsePortalSignInSearch(search))).toBe(
      url,
    );
    expect(url).not.toMatch(/@|password|code/iu);
  });

  it("preserves in-progress whitespace in catalogue search URLs", () => {
    const url = routes.portalCatalogue.build({ q: "printer " });
    const search = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    expect(parsePortalCatalogueSearch(search)).toEqual({ q: "printer " });
    expect(
      routes.portalCatalogue.build(parsePortalCatalogueSearch(search)),
    ).toBe(url);
  });
});

describe("God Mode Users and requester pending-action URLs", () => {
  it("round-trips user filters and selected account through the URL", () => {
    const search = {
      q: "  Ada Lovelace  ",
      side: "staff" as const,
      active: "false" as const,
      organisationId: "org/one",
      cursor: "cursor/a+b",
      user: "user/one",
    };
    const url = routes.godModeUsers.build(search);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(parseGodModeUsersSearch(Object.fromEntries(params))).toEqual({
      ...search,
      q: "Ada Lovelace",
    });
    expect(url).toContain("organisationId=org%2Fone");
  });

  it("round-trips only an allowlisted action when a user is selected", () => {
    const url = routes.godModeUsers.build({
      user: "user/one",
      action: "reset-mfa",
      q: "Ada",
    });
    expect(url).toBe(
      "/agent/god-mode/users?q=Ada&user=user%2Fone&action=reset-mfa",
    );
    expect(
      parseGodModeUsersSearch(
        Object.fromEntries(new URL(url, "https://taskdesk.test").searchParams),
      ),
    ).toEqual({
      q: "Ada",
      user: "user/one",
      action: "reset-mfa",
    });
  });

  it("drops unknown actions, actions without a target, and sensitive form values", () => {
    expect(
      parseGodModeUsersSearch({
        user: "user/one",
        action: "delete-everything",
        secret: "never-in-url",
        reason: "private reason",
      }),
    ).toEqual({ user: "user/one" });
    expect(parseGodModeUsersSearch({ action: "suspend" })).toEqual({});
    expect(routes.godModeUsers.build({ action: "suspend" })).toBe(
      "/agent/god-mode/users",
    );
  });

  it("round-trips requester pagination and encodes the detail id", () => {
    const url = routes.pendingActions.build({ cursor: "cursor/a+b" });
    expect(parsePendingActionsSearchFromQueryString(url.split("?")[1])).toEqual(
      parsePendingActionsSearch({ cursor: "cursor/a+b" }),
    );
    expect(url).toBe(
      "/agent/settings/profile/pending-actions?cursor=cursor%2Fa%2Bb",
    );
    expect(routes.pendingAction.build({ id: "action/one" })).toBe(
      "/agent/settings/profile/pending-actions/action%2Fone",
    );
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

describe("routes.savedView (SV-19: the URL fully encodes the view)", () => {
  const search = {
    workspaceId: "workspace/1",
    scope: "project" as const,
    scopeId: "project-1",
    layout: "list",
    filter: '(priority:high OR assignee:@me) AND project:"OPS, Platform"',
    filterMode: "text" as const,
    sort: "priority" as const,
    dir: "desc" as const,
    columns: ["key", "state", "priority"],
  } satisfies SavedViewUrlSearch;

  it("round-trips workspace, scope, layout, filter, mode, sort and columns", () => {
    const url = routes.savedView.build({ id: "view/one" }, search);
    expect(url.startsWith("/agent/views/view%2Fone?")).toBe(true);
    const [, query] = url.split("?");
    expect(parseSavedViewUrlSearchFromQueryString(query ?? "")).toEqual(search);
  });

  it("is idempotent: rebuilding from the parsed URL gives the same URL", () => {
    const url = routes.savedView.build({ id: "v" }, search);
    const [, query] = url.split("?");
    expect(
      routes.savedView.build(
        { id: "v" },
        parseSavedViewUrlSearchFromQueryString(query ?? ""),
      ),
    ).toBe(url);
  });

  it("builds a bare path when nothing is known and adds no defaults", () => {
    expect(routes.savedView.build({ id: "v" })).toBe("/agent/views/v");
    expect(parseSavedViewUrlSearch({})).toEqual({});
    expect(parseSavedViewUrlSearch(undefined)).toEqual({});
    expect(parseSavedViewUrlSearch({ sort: "title" })).toEqual({
      sort: "title",
    });
  });

  it("drops every invalid or hostile part without throwing and keeps the rest", () => {
    expect(
      parseSavedViewUrlSearch({
        workspaceId: "w".repeat(201),
        scope: "organisation",
        scopeId: "",
        layout: "kanban",
        sort: "position",
        dir: "sideways",
        filter: "a\u0000b",
        columns: ["nope"],
        cursor: "ignored",
      }),
    ).toEqual({});
    expect(
      parseSavedViewUrlSearch({ workspaceId: "w1", layout: "board" }),
    ).toEqual({ workspaceId: "w1", layout: "board" });
  });

  it("carries no cursor: a continuation is bound to one viewer and cannot be shared", () => {
    expect(
      routes.savedView.build({ id: "v" }, {
        ...search,
        cursor: "abc",
      } as never),
    ).not.toContain("cursor");
  });

  it("is a generated route", () => {
    expect(generatedRouteMetadata.agent).toContain(routes.savedView.path);
  });
});

describe("routes.savedViews", () => {
  it("round-trips the name filter and bounds it", () => {
    const url = routes.savedViews.build({ query: "  my / view  " });
    expect(url).toBe("/agent/views?query=my+%2F+view");
    expect(
      parseSavedViewsSearch({ query: "x".repeat(201) }).query,
    ).toHaveLength(200);
    expect(parseSavedViewsSearch({ query: "   " })).toEqual({});
    expect(routes.savedViews.build()).toBe("/agent/views");
  });

  it("is a generated route", () => {
    expect(generatedRouteMetadata.agent).toContain(routes.savedViews.path);
  });
});
