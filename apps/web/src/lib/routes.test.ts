import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import { projectViewRoutes } from "./project-view-routes";
import {
  buildGeneratedRouteUrl,
  DEFAULT_WORK_ITEM_LIST_SEARCH,
  parseAccountSecuritySearch,
  parseAgentGlobalSearch,
  parseAgentHomeSearch,
  parseAgentHomeSearchFromQueryString,
  parseAgentInboxSearch,
  parseAgentMyWorkSearch,
  parseCannedResponseSearch,
  parseGeneratedRouteUrl,
  parseGodModeImportsSearch,
  parseGodModeUsersSearch,
  parseIdentityConnectionEditorSearch,
  parseIdentityConnectionEditorSearchFromQueryString,
  parseIntakeSearch,
  parseLabelCatalogueSearch,
  parsePendingActionsSearch,
  parsePendingActionsSearchFromQueryString,
  parsePortalCatalogueSearch,
  parsePortalSignInSearch,
  parseRequestTypeEditorSearch,
  parseSavedViewsSearch,
  parseSavedViewUrlSearch,
  parseSavedViewUrlSearchFromQueryString,
  parseServiceCalendarListSearchFromQueryString,
  parseSettingsTextFilterSearch,
  parseSlaPolicyListSearch,
  parseWorkItemDetailSearch,
  parseWorkItemListSearch,
  parseWorkItemListSearchFromQueryString,
  parseWorkItemTemplateSearch,
  parseWorkItemWorkSearch,
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
          layout: "calendar", // not built yet -- falls back to list
          sort: "not-a-real-field",
          dir: "sideways",
        }),
      ).toEqual(DEFAULT_WORK_ITEM_LIST_SEARCH);

      expect(
        parseWorkItemListSearch({
          layout: "table",
          sort: "priority",
          dir: "desc",
        }),
      ).toEqual({ layout: "table", sort: "priority", dir: "desc" });

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

describe("routes.agentHome", () => {
  it("round-trips the explicit recovery mode and drops unknown values", () => {
    const url = routes.agentHome.build({ recovery: "deleted" });
    expect(url).toBe("/agent?recovery=deleted");
    expect(
      parseAgentHomeSearch({
        recovery: new URL(url, "https://example.test").searchParams.get(
          "recovery",
        ),
      }),
    ).toEqual({ recovery: "deleted" });
    expect(parseAgentHomeSearch({ recovery: "anything-else" })).toEqual({});
    expect(routes.agentHome.build({})).toBe("/agent");
  });

  it("round-trips the S5 engagement kind filter, alone and with recovery", () => {
    const url = routes.agentHome.build({ kind: "managed_service" });
    expect(url).toBe("/agent?kind=managed_service");
    expect(
      parseAgentHomeSearchFromQueryString(
        new URL(url, "https://example.test").search,
      ),
    ).toEqual({ kind: "managed_service" });
    expect(
      routes.agentHome.build({ recovery: "deleted", kind: "project" }),
    ).toBe("/agent?recovery=deleted&kind=project");
    expect(parseAgentHomeSearch({ kind: "catalogue" })).toEqual({});
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
      "/dashboard/settings/workspace/request-types",
    );
    expect(generatedRouteMetadata.agent).toContain(
      "/dashboard/settings/workspace/workflows",
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
  it("inherits a saved queue state only when the URL has no explicit state", () => {
    expect(parseIntakeSearch({ queue: "pair-17" })).not.toHaveProperty("state");
    expect(routes.intakeQueue.build({ queue: "pair-17" })).toBe(
      "/agent/triage?queue=pair-17",
    );
    expect(
      parseIntakeSearch({ queue: "pair-17", state: "accepted" }),
    ).toMatchObject({ state: "accepted" });
    expect(parseIntakeSearch({})).toEqual({ state: "new" });
  });
  it("round-trips canonical paired work-item query overrides", () => {
    const url = routes.intakeQueue.build({
      queue: "pair-17",
      workItemFilter: "priority:high",
      workItemSorts: [{ field: "title", order: "desc" }],
      workItemColumns: ["key", "title"],
      workItemFilterMode: "text",
    });
    const parsed = parseIntakeSearch(
      Object.fromEntries(new URL(url, "https://example.test").searchParams),
    );
    expect(parsed.workItemSorts).toEqual([{ field: "title", order: "desc" }]);
    expect(parsed.workItemColumns).toEqual(["key", "title"]);
    expect(routes.intakeQueue.build(parsed)).toBe(url);
  });
  it("preserves a bounded saved queue association alongside submission filters", () => {
    const url = routes.intakeQueue.build({
      state: "clarifying",
      queue: "queue_pair-17",
      assignee: "claimed",
      age: "7d",
    });
    const parsed = parseIntakeSearch(
      Object.fromEntries(new URL(url, "https://example.test").searchParams),
    );
    expect(parsed).toMatchObject({
      queue: "queue_pair-17",
      state: "clarifying",
      assignee: "claimed",
      age: "7d",
    });
    expect(routes.intakeQueue.build(parsed)).toBe(url);
    expect(parseIntakeSearch({ queue: "x".repeat(129) })).not.toHaveProperty(
      "queue",
    );
    expect(parseIntakeSearch({ queue: "bad/id" })).not.toHaveProperty("queue");
  });

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

  it("round-trips the richer triage filters and drops invalid ones", () => {
    const url = routes.intakeQueue.build({
      state: "new",
      requestType: "rt_1",
      assignee: "unclaimed",
      age: "3d",
    });
    const search = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    const parsed = parseIntakeSearch(search);
    expect(parsed).toEqual({
      state: "new",
      requestType: "rt_1",
      assignee: "unclaimed",
      age: "3d",
    });
    expect(routes.intakeQueue.build(parsed)).toBe(url);
    expect(
      parseIntakeSearch({ assignee: "me", age: "2y", requestType: "" }),
    ).toEqual({
      state: "new",
    });
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
    expect(url).toBe("/god-mode/users?q=Ada&user=user%2Fone&action=reset-mfa");
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
      "/god-mode/users",
    );
  });

  it("round-trips requester pagination and encodes the detail id", () => {
    const url = routes.pendingActions.build({ cursor: "cursor/a+b" });
    expect(parsePendingActionsSearchFromQueryString(url.split("?")[1])).toEqual(
      parsePendingActionsSearch({ cursor: "cursor/a+b" }),
    );
    expect(url).toBe(
      "/dashboard/settings/account/pending-actions?cursor=cursor%2Fa%2Bb",
    );
    expect(routes.pendingAction.build({ id: "action/one" })).toBe(
      "/dashboard/settings/account/pending-actions/action%2Fone",
    );
  });
});

describe("routes.serviceCalendars", () => {
  it("builds the list route named by the screen inventory", () => {
    expect(routes.serviceCalendars.build()).toBe(
      "/dashboard/settings/workspace/calendars",
    );
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
    expect(url).toBe(
      "/dashboard/settings/workspace/calendars/cal%2Fone?year=2026",
    );
    expect(
      parseCalendarEditorSearch({
        year: new URL(url, "https://taskdesk.invalid").searchParams.get("year"),
      }),
    ).toEqual({ year: 2026 });
  });

  it("does not add search state when the year is not supplied", () => {
    expect(routes.serviceCalendarEditor.build({ id: "new" })).toBe(
      "/dashboard/settings/workspace/calendars/new",
    );
  });
});

describe("routes.slaPolicies", () => {
  it("round-trips the list cursor and editor id through registered route builders", () => {
    const url = routes.slaPolicies.build({ cursor: "opaque/a+b" });
    expect(url).toBe(
      "/dashboard/settings/workspace/sla-policies?cursor=opaque%2Fa%2Bb",
    );
    expect(
      parseSlaPolicyListSearch({
        cursor: new URL(url, "https://taskdesk.invalid").searchParams.get(
          "cursor",
        ),
      }),
    ).toEqual({ cursor: "opaque/a+b" });
    expect(routes.slaPolicyEditor.build({ id: "policy/one" })).toBe(
      "/dashboard/settings/workspace/sla-policies/policy%2Fone",
    );
  });
});

describe("routes.identityConnections", () => {
  it("builds the routes the screen inventory names", () => {
    expect(routes.identityConnections.build()).toBe("/god-mode/authentication");
    expect(routes.identityConnectionEditor.build({ id: "new" })).toBe(
      "/god-mode/authentication/new",
    );
    expect(routes.identityConnectionEditor.build({ id: "conn/a" })).toBe(
      "/god-mode/authentication/conn%2Fa",
    );
    expect(generatedRouteMetadata.agent).toContain(
      routes.identityConnections.path,
    );
    expect(generatedRouteMetadata.agent).toContain(
      routes.identityConnectionEditor.path,
    );
  });

  it("round-trips the open tab, events cursor and mapping selection through the URL", () => {
    for (const search of [
      { tab: "scim" as const },
      { tab: "scim" as const, mapping: "new" },
      { tab: "scim" as const, mapping: "map/1" },
      { tab: "events" as const },
      { tab: "events" as const, eventsCursor: "abc_DEF-123" },
    ]) {
      const url = routes.identityConnectionEditor.build(
        { id: "conn-1" },
        search,
      );
      expect(
        parseIdentityConnectionEditorSearchFromQueryString(
          url.split("?")[1] ?? "",
        ),
      ).toEqual(search);
    }
  });

  it("only keeps state that belongs to the open tab and drops everything else", () => {
    expect(
      parseIdentityConnectionEditorSearch({ tab: "scim", eventsCursor: "abc" }),
    ).toEqual({ tab: "scim" });
    expect(
      parseIdentityConnectionEditorSearch({ tab: "events", mapping: "new" }),
    ).toEqual({ tab: "events" });
    expect(
      parseIdentityConnectionEditorSearch({
        mapping: "new",
        eventsCursor: "abc",
      }),
    ).toEqual({});
    expect(parseIdentityConnectionEditorSearch({ tab: "connection" })).toEqual(
      {},
    );
    expect(parseIdentityConnectionEditorSearch({ tab: "nope" })).toEqual({});
  });

  it("rejects a malformed or oversized events cursor and never carries secrets or form values", () => {
    expect(
      parseIdentityConnectionEditorSearch({
        tab: "events",
        eventsCursor: "has space",
      }),
    ).toEqual({ tab: "events" });
    expect(
      parseIdentityConnectionEditorSearch({
        tab: "events",
        eventsCursor: "x".repeat(513),
      }),
    ).toEqual({ tab: "events" });
    expect(
      parseIdentityConnectionEditorSearch({
        tab: "scim",
        password: "never-in-url",
        token: "never-in-url",
      }),
    ).toEqual({ tab: "scim" });
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

describe("God Mode import routes", () => {
  it("round-trips selected workspace for history and encoded run-detail URLs", () => {
    expect(routes.godModeImports.build()).toBe("/god-mode/imports");
    expect(routes.godModeImports.build({ workspaceId: "workspace/one" })).toBe(
      "/god-mode/imports?workspaceId=workspace%2Fone",
    );
    expect(routes.godModeImportRun.build({ id: "run/with spaces" })).toBe(
      "/god-mode/imports/run%2Fwith%20spaces",
    );
    expect(
      routes.godModeImportRun.build(
        { id: "run-1" },
        { workspaceId: "workspace-1" },
      ),
    ).toBe("/god-mode/imports/run-1?workspaceId=workspace-1");
    expect(parseGodModeImportsSearch({ workspaceId: "workspace-1" })).toEqual({
      workspaceId: "workspace-1",
    });
    expect(parseGodModeImportsSearch({ workspaceId: "x".repeat(201) })).toEqual(
      {},
    );
    expect(generatedRouteMetadata.agent).toContain(routes.godModeImports.path);
    expect(generatedRouteMetadata.agent).toContain(
      routes.godModeImportRun.path,
    );
  });

  it("keeps the import wizard step in the URL and drops unknown steps", () => {
    expect(
      routes.godModeImportRun.build(
        { id: "run-1" },
        { workspaceId: "workspace-1", step: "mapping" },
      ),
    ).toBe("/god-mode/imports/run-1?workspaceId=workspace-1&step=mapping");
    expect(routes.godModeImports.build({ step: "connect" })).toBe(
      "/god-mode/imports?step=connect",
    );
    expect(parseGodModeImportsSearch({ step: "dry-run" })).toEqual({
      step: "dry-run",
    });
    expect(parseGodModeImportsSearch({ step: "nope" })).toEqual({});
  });
});

describe("routes.projectBacklog and ?item={key} side pane URL state (VW-4)", () => {
  it("round-trips ?item={key} on routes.workItemList, routes.projectBacklog, and routes.savedView", () => {
    const workUrl = routes.workItemList.build(
      { projectKey: "PROJ" },
      { layout: "list", sort: "key", dir: "asc", item: "PROJ-42" },
    );
    expect(workUrl).toContain("item=PROJ-42");
    expect(
      parseWorkItemListSearchFromQueryString(workUrl.split("?")[1] ?? ""),
    ).toEqual({
      layout: "list",
      sort: "key",
      dir: "asc",
      item: "PROJ-42",
    });

    const backlogUrl = routes.projectBacklog.build(
      { projectKey: "PROJ" },
      { item: "PROJ-99", filter: "priority:high" },
    );
    expect(backlogUrl.startsWith("/agent/projects/PROJ/backlog?")).toBe(true);
    expect(backlogUrl).toContain("item=PROJ-99");
    expect(
      parseWorkItemListSearchFromQueryString(backlogUrl.split("?")[1] ?? ""),
    ).toEqual({
      layout: "list",
      sort: "key",
      dir: "asc",
      filter: "priority:high",
      item: "PROJ-99",
    });
    expect(generatedRouteMetadata.agent).toContain(routes.projectBacklog.path);

    const viewUrl = routes.savedView.build(
      { id: "view-1" },
      { workspaceId: "ws-1", item: "PROJ-7" },
    );
    expect(viewUrl).toContain("item=PROJ-7");
    expect(
      parseSavedViewUrlSearchFromQueryString(viewUrl.split("?")[1] ?? ""),
    ).toEqual({
      workspaceId: "ws-1",
      item: "PROJ-7",
    });
  });
});

describe("P1 agent core, project overview, and settings routes", () => {
  it("registers all 18 Batch 4 routes in generatedRouteMetadata.agent", () => {
    const expectedPaths = [
      routes.agentHome.path,
      routes.agentInbox.path,
      routes.agentMyWork.path,
      routes.agentSearch.path,
      routes.projectOverview.path,
      routes.accountInformation.path,
      routes.accountPreferences.path,
      routes.workspaceGeneral.path,
      routes.workspaceMembers.path,
      routes.workspaceStates.path,
      routes.workspaceLabels.path,
      routes.workspaceCannedResponses.path,
      routes.workspaceWorkItemTemplates.path,
      routes.workspaceDangerZone.path,
      routes.projectSettings.path,
      routes.projectMembers.path,
      routes.projectStates.path,
      routes.projectLabels.path,
      routes.projectDangerZone.path,
    ];
    for (const path of expectedPaths) {
      expect(generatedRouteMetadata.agent).toContain(path);
    }
  });

  it("round-trips agentInbox, agentMyWork, agentSearch, and settings text filters", () => {
    expect(routes.agentHome.build()).toBe("/agent");
    expect(routes.agentInbox.build()).toBe("/agent/inbox");
    expect(routes.agentInbox.build({ filter: "unread" })).toBe(
      "/agent/inbox?filter=unread",
    );
    expect(parseAgentInboxSearch({ filter: "unread" })).toEqual({
      filter: "unread",
    });
    expect(parseAgentInboxSearch({ filter: "invalid" })).toEqual({});
    expect(routes.agentInbox.build({ filter: "mentions" })).toBe(
      "/agent/inbox?filter=mentions",
    );
    expect(routes.agentInbox.build({ filter: "assignments" })).toBe(
      "/agent/inbox?filter=assignments",
    );
    expect(parseAgentInboxSearch({ filter: "assignments" })).toEqual({
      filter: "assignments",
    });

    const myWorkUrl = routes.agentMyWork.build({
      lens: "watching",
      q: "reset",
      item: "HELP-7",
    });
    expect(myWorkUrl).toBe("/agent/my-work?lens=watching&q=reset&item=HELP-7");
    expect(
      parseAgentMyWorkSearch({
        lens: "watching",
        q: "reset",
        item: "HELP-7",
      }),
    ).toEqual({
      lens: "watching",
      q: "reset",
      item: "HELP-7",
    });

    const searchUrl = routes.agentSearch.build({
      q: "billing",
      scope: "work-items",
    });
    expect(searchUrl).toBe("/agent/search?q=billing&scope=work-items");
    expect(
      routes.workspaceSearch.build(
        { workspaceId: "w 1" },
        { q: "HELP-24", scope: "projects" },
      ),
    ).toBe("/dashboard/workspace/w%201/search?q=HELP-24&scope=projects");
    expect(routes.workspaceSearch.build({ workspaceId: "w1" })).toBe(
      "/dashboard/workspace/w1/search",
    );
    expect(
      parseAgentGlobalSearch({ q: "billing", scope: "work-items" }),
    ).toEqual({
      q: "billing",
      scope: "work-items",
    });

    expect(routes.workspaceMembers.build({ q: "ada" })).toBe(
      "/dashboard/settings/workspace/members?q=ada",
    );
    expect(routes.workspaceCannedResponses.build({ q: "reset" })).toBe(
      "/dashboard/settings/workspace/canned-responses?q=reset",
    );
    expect(parseSettingsTextFilterSearch({ q: "ada" })).toEqual({ q: "ada" });
  });

  it("round-trips canned-response search, editor and deletion confirmation", () => {
    for (const search of [
      { q: "reset reply", id: "snippet/1" },
      { id: "new" },
      { q: "reset", id: "snippet-1", action: "delete" as const },
    ]) {
      const url = new URL(
        routes.workspaceCannedResponses.build(search),
        "https://example.test",
      );
      expect(
        parseCannedResponseSearch(Object.fromEntries(url.searchParams)),
      ).toEqual(search);
    }
    expect(
      parseCannedResponseSearch({ id: "bad\u0000id", action: "delete" }),
    ).toEqual({});
    expect(
      parseCannedResponseSearch({ action: "delete", q: "  reset  " }),
    ).toEqual({ q: "reset" });
  });

  it("round-trips work-item template search, editor and library", () => {
    for (const search of [
      { q: "bug" },
      { id: "new" },
      { id: "tpl/1", library: "checklists" as const },
    ]) {
      const url = new URL(
        routes.workspaceWorkItemTemplates.build(search),
        "https://example.test",
      );
      expect(
        parseWorkItemTemplateSearch(Object.fromEntries(url.searchParams)),
      ).toEqual(search);
    }
    expect(parseWorkItemTemplateSearch({ id: "bad\u0000id" })).toEqual({});
    expect(parseWorkItemTemplateSearch({ library: "other" })).toEqual({});
  });

  it("builds project overview and project settings URLs with encoded projectKey", () => {
    expect(routes.projectOverview.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP",
    );
    expect(routes.projectSettings.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP/settings",
    );
    expect(routes.projectMembers.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP/settings/members",
    );
    expect(routes.projectStates.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP/settings/states",
    );
    expect(routes.projectLabels.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP/settings/labels",
    );
    expect(routes.projectDangerZone.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP/settings/danger",
    );
  });
});

describe("L-03 account and project settings URLs", () => {
  it("registers only paths that exist in the generated agent tree", () => {
    for (const path of [
      routes.accountInformation.path,
      routes.accountNotifications.path,
      routes.accountPreferences.path,
      routes.accountSecurity.path,
      routes.accountDeveloper.path,
      routes.workspaceGeneral.path,
      routes.projectSettingsGeneral.path,
      routes.projectSettingsMembers.path,
      routes.projectSettingsLabels.path,
      routes.projectSettingsWorkflow.path,
      routes.projectSettingsFeatures.path,
      routes.projectSettingsAutomations.path,
      routes.projectSettingsEstimates.path,
      routes.projectSettingsBudget.path,
    ]) {
      expect(generatedRouteMetadata.agent).toContain(path);
    }
  });

  it("builds account URLs and encoded project settings URLs", () => {
    expect(routes.accountInformation.build()).toBe(
      "/dashboard/settings/account/information",
    );
    expect(routes.accountNotifications.build()).toBe(
      "/dashboard/settings/account/notifications",
    );
    expect(routes.accountPreferences.build()).toBe(
      "/dashboard/settings/account/preferences",
    );
    expect(routes.accountDeveloper.build()).toBe(
      "/dashboard/settings/account/developer",
    );
    expect(routes.workspaceGeneral.build()).toBe(
      "/dashboard/settings/workspace/general",
    );
    const params = { projectId: "p 1" };
    expect(routes.projectSettingsGeneral.build(params)).toBe(
      "/dashboard/settings/projects/p%201/general",
    );
    expect(routes.projectSettingsMembers.build(params)).toBe(
      "/dashboard/settings/projects/p%201/members",
    );
    expect(routes.projectSettingsWorkflow.build(params)).toBe(
      "/dashboard/settings/projects/p%201/workflow",
    );
    expect(routes.projectSettingsFeatures.build(params)).toBe(
      "/dashboard/settings/projects/p%201/features",
    );
    expect(routes.projectSettingsAutomations.build(params)).toBe(
      "/dashboard/settings/projects/p%201/automations",
    );
    expect(routes.projectSettingsEstimates.build(params)).toBe(
      "/dashboard/settings/projects/p%201/estimates",
    );
    expect(routes.projectSettingsBudget.build(params)).toBe(
      "/dashboard/settings/projects/p%201/budget",
    );
  });

  it("keeps the project label catalogue's dialog state in the query", () => {
    expect(routes.projectSettingsLabels.build({ projectId: "p1" })).toBe(
      "/dashboard/settings/projects/p1/labels",
    );
    const url = new URL(
      routes.projectSettingsLabels.build(
        { projectId: "p1" },
        { action: "edit", label: "bug" },
      ),
      "https://example.test",
    );
    expect(url.pathname).toBe("/dashboard/settings/projects/p1/labels");
    expect(
      parseLabelCatalogueSearch(Object.fromEntries(url.searchParams)),
    ).toEqual({ action: "edit", label: "bug" });
  });
});

describe("label catalogue dialog URLs", () => {
  it("round-trips each action and opaque label identifiers", () => {
    for (const action of ["create", "edit", "delete"] as const) {
      const search =
        action === "create" ? { action } : { action, label: "label /?#é" };
      for (const url of [
        routes.workspaceLabels.build(search),
        routes.projectLabels.build({ projectKey: "HELP" }, search),
      ]) {
        expect(
          parseLabelCatalogueSearch(
            Object.fromEntries(new URLSearchParams(url.split("?")[1])),
          ),
        ).toEqual(search);
      }
    }
  });
  it("drops invalid actions and identifiers instead of binding a stale dialog", () => {
    for (const raw of [
      null,
      { action: "unknown" },
      { action: "edit" },
      { action: "delete", label: "" },
      { action: "edit", label: "a".repeat(257) },
      { action: "edit", label: "a\0b" },
      { action: "edit", label: 42 },
    ]) {
      expect(parseLabelCatalogueSearch(raw)).toEqual({});
    }
    expect(
      parseLabelCatalogueSearch({ action: "create", label: "stale" }),
    ).toEqual({ action: "create" });
  });
});

describe("item-scoped Kaneo disclosure URLs", () => {
  it("retains detail sections alongside the comment and activity selection", () => {
    const sections = {
      itemKey: "HELP-4",
      open: ["sla", "approvals"] as ("sla" | "approvals")[],
    };
    const url = routes.workItemDetail.build(
      { key: "HELP-4" },
      { sections, comment: "comment-1", activity: "comments" },
    );
    expect(
      parseWorkItemDetailSearch(
        Object.fromEntries(new URLSearchParams(url.split("?")[1])),
      ),
    ).toEqual({ sections, comment: "comment-1", activity: "comments" });
  });
  it("retains disclosure state on the board without losing its order or item", () => {
    const sections = {
      itemKey: "HELP-4",
      open: ["attachments"] as "attachments"[],
    };
    const url = routes.workItemList.build(
      { projectKey: "HELP" },
      {
        layout: "board",
        sort: "position",
        dir: "asc",
        item: "HELP-4",
        sections,
      },
    );
    expect(parseWorkItemListSearchFromQueryString(url.split("?")[1])).toEqual({
      layout: "board",
      sort: "position",
      dir: "asc",
      item: "HELP-4",
      sections,
    });
  });
  it("does not preserve unsupported section names from a shared URL", () => {
    expect(
      parseWorkItemDetailSearch({
        sections: JSON.stringify({ itemKey: "HELP-4", open: ["secrets"] }),
      }),
    ).toEqual({});
  });
});

describe("work route grouping URL state (VW-13, VW-1)", () => {
  it.each(["label", "cf.business_impact", "cf.constructor"] as const)(
    "round-trips the registered grouping syntax %s",
    (group) => {
      const url = routes.workItemList.build(
        { projectKey: "PROJ" },
        { layout: "board", group },
      );
      const params = new URLSearchParams(url.split("?")[1]);
      expect(params.get("group")).toBe(group);
      expect(parseWorkItemWorkSearch(Object.fromEntries(params)).group).toBe(
        group,
      );
    },
  );

  it.each(["cf.", "cf.business-impact", "cf.__proto__", "cf.a/b"])(
    "rejects malformed custom grouping syntax %s",
    (group) => {
      expect(parseWorkItemWorkSearch({ group })).not.toHaveProperty("group");
    },
  );

  it("parses a valid group, ignores an invalid one, and never invents one", () => {
    expect(
      parseWorkItemWorkSearch({ layout: "board", group: "assignee" }),
    ).toMatchObject({
      layout: "board",
      group: "assignee",
    });
    expect(parseWorkItemWorkSearch({ group: "priority" }).group).toBe(
      "priority",
    );
    expect(parseWorkItemWorkSearch({ group: "cycle" })).not.toHaveProperty(
      "group",
    );
    expect(parseWorkItemWorkSearch({})).not.toHaveProperty("group");
    expect(parseWorkItemWorkSearch(null)).toMatchObject({ layout: "list" });
  });

  it("round-trips combined board scope and clears it outside board layout", () => {
    const url = new URL(
      routes.workItemList.build(
        { projectKey: "PROJ" },
        { layout: "board", combined: "descendants", group: "priority" },
      ),
      "https://ticketing.invalid",
    );
    expect(
      parseWorkItemWorkSearch(Object.fromEntries(url.searchParams)),
    ).toMatchObject({
      layout: "board",
      combined: "descendants",
      group: "priority",
    });
    expect(
      parseWorkItemWorkSearch({ layout: "table", combined: "descendants" }),
    ).not.toHaveProperty("combined");
    expect(
      parseWorkItemWorkSearch({ layout: "board", combined: "all" }),
    ).not.toHaveProperty("combined");
  });

  it("writes the group into the builder, but never the default state grouping", () => {
    const url = routes.workItemList.build(
      { projectKey: "PROJ" },
      { layout: "board", group: "assignee" },
    );
    expect(new URLSearchParams(url.split("?")[1]).get("group")).toBe(
      "assignee",
    );
    expect(
      routes.workItemList.build({ projectKey: "PROJ" }, { group: "state" }),
    ).not.toContain("group=");
    expect(routes.workItemList.build({ projectKey: "PROJ" })).not.toContain(
      "group=",
    );
  });

  it("round-trips the group through build then parse, with the list state beside it", () => {
    const url = routes.workItemList.build(
      { projectKey: "PROJ" },
      {
        layout: "board",
        sort: "priority",
        dir: "desc",
        group: "priority",
        filter: "x = 1",
      },
    );
    const params = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
    expect(parseWorkItemWorkSearch(params)).toMatchObject({
      layout: "board",
      sort: "priority",
      dir: "desc",
      group: "priority",
      filter: "x = 1",
    });
  });
});

describe("account security URL state", () => {
  it("preserves enrollment and a bounded opaque linking intent on reload", () => {
    const intent = "opaque_link_intent_123456789";
    const url = routes.accountSecurity.build({
      enrollmentRequired: true,
      identityLinkIntent: intent,
    });
    const parsed = parseAccountSecuritySearch(
      Object.fromEntries(
        new URL(url, "https://ticketing.localhost").searchParams,
      ),
    );
    expect(parsed).toEqual({
      enrollmentRequired: true,
      identityLinkIntent: intent,
    });
  });
  it("rejects paths, control bytes, arrays and oversized intent state", () => {
    for (const value of [
      "../other",
      "x".repeat(129),
      ["opaque_link_intent_123456789"],
      "opaque_link_intent_\\n",
      "https://elsewhere.invalid/",
    ])
      expect(
        parseAccountSecuritySearch({
          identityLinkIntent: value,
          arbitrary: "ignored",
        }),
      ).toEqual({});
  });
});
