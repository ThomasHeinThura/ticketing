import { describe, expect, it, vi } from "vitest";
import {
  parseProjectCalendarSearch,
  parseProjectViewSearchFromParams,
} from "./project-board-search";
import {
  buildProjectViewSwitchUrl,
  createProjectViewShortcutHandlers,
  normalizeCanonicalWorkItemSelection,
  type ProjectView,
} from "./project-layout-navigation";
import { projectViewRoutes } from "./project-view-routes";
import { parseWorkItemListSearchFromQueryString } from "./routes";

describe("project layout navigation", () => {
  it("keeps canonical filter meaning when shortcuts return from calendar to work", () => {
    const filter = "AND(priority:high,label:Customer)";
    const url = buildProjectViewSwitchUrl(
      "board",
      { workspaceId: "ws", projectId: "project", projectKey: "service-team" },
      `?filter=${encodeURIComponent(filter)}&month=2026-10`,
    );
    expect(
      new URL(url, "https://agent.invalid").searchParams.get("filter"),
    ).toBe(filter);
    expect(url).toMatch(/^\/agent\/projects\/service-team\/work\?/);
  });
  const canonical = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    projectKey: "HELP",
  };
  it.each(["calendar", "gantt"] as const)(
    "round trips permanent selection and scoped panels through %s",
    (view) => {
      const hierarchy = {
        itemKey: "HELP-1",
        collapsed: true,
        expanded: ["HELP-2"],
      };
      const relations = {
        itemKey: "HELP-1",
        picker: true,
        query: "SSO",
        type: "blocked_by",
      };
      const query = new URLSearchParams({
        item: "HELP-1",
        hierarchy: JSON.stringify(hierarchy),
        relations: JSON.stringify(relations),
        filter: "priority:high",
        month: "2026-10",
      });
      const schedule = new URL(
        buildProjectViewSwitchUrl(view, canonical, `?${query}`),
        "https://agent.invalid",
      );
      expect(schedule.searchParams.get("taskId")).toBe("HELP-1");
      expect(schedule.searchParams.has("item")).toBe(false);
      const validated = parseProjectViewSearchFromParams(
        schedule.searchParams,
        parseProjectCalendarSearch,
      );
      expect(validated).toMatchObject({
        taskId: "HELP-1",
        hierarchy,
        relations,
        filter: "priority:high",
      });
      for (const destination of ["board", "list", "backlog"] as const) {
        const next = new URL(
          buildProjectViewSwitchUrl(destination, canonical, schedule.search),
          "https://agent.invalid",
        );
        expect(next.searchParams.get("item")).toBe("HELP-1");
        expect(next.searchParams.has("taskId")).toBe(false);
        expect(JSON.parse(next.searchParams.get("hierarchy") ?? "{}")).toEqual(
          hierarchy,
        );
        expect(JSON.parse(next.searchParams.get("relations") ?? "{}")).toEqual(
          relations,
        );
        if (destination !== "backlog")
          expect(
            parseWorkItemListSearchFromQueryString(next.search),
          ).toMatchObject({
            item: "HELP-1",
            hierarchy,
            relations,
            layout: destination,
          });
      }
    },
  );
  it("drops panels scoped to a different selected item without changing filters", () => {
    const query = new URLSearchParams({
      taskId: "HELP-1",
      hierarchy: JSON.stringify({ itemKey: "OTHER-2", collapsed: true }),
      relations: JSON.stringify({ itemKey: "OTHER-2", picker: true }),
      filter: "priority:high",
    });
    const next = new URL(
      buildProjectViewSwitchUrl("board", canonical, `?${query}`),
      "https://agent.invalid",
    );
    expect(next.searchParams.get("item")).toBe("HELP-1");
    expect(next.searchParams.get("filter")).toBe("priority:high");
    expect(next.searchParams.has("hierarchy")).toBe(false);
    expect(next.searchParams.has("relations")).toBe(false);
  });
  it("normalizes direct schedule-key aliases but never guesses a canonical key from a UUID", () => {
    expect(
      normalizeCanonicalWorkItemSelection({
        taskId: "HELP-1",
        filter: "priority:high",
      }),
    ).toMatchObject({ item: "HELP-1", filter: "priority:high" });
    const legacyId = "f3d637ba-77bf-43e2-bd63-356da999a531";
    expect(
      normalizeCanonicalWorkItemSelection({ taskId: legacyId }),
    ).not.toHaveProperty("item");
    const next = new URL(
      buildProjectViewSwitchUrl("board", canonical, `?taskId=${legacyId}`),
      "https://agent.invalid",
    );
    expect(next.searchParams.has("item")).toBe(false);
    expect(next.searchParams.get("taskId")).toBe(legacyId);
  });

  it("normalizes supported legacy priorities and sort on header navigation", () => {
    const url = new URL(
      buildProjectViewSwitchUrl(
        "list",
        canonical,
        "?priority=high&sort=number&filter=state%3Astarted",
      ),
      "https://test.invalid",
    );
    expect(url.pathname).toBe("/agent/projects/HELP/work");
    expect(url.searchParams.get("layout")).toBe("list");
    expect(url.searchParams.get("sort")).toBe("key");
    expect(url.searchParams.get("filter")).toBe(
      "AND(state:started,priority:in(high))",
    );
  });
  const params = { workspaceId: "workspace-1", projectId: "project-1" };

  it.each([
    [
      "backlog",
      projectViewRoutes.projectBacklog.build(params, { taskId: "task-1" }),
    ],
    [
      "board",
      projectViewRoutes.projectBoard.build(params, {
        taskId: "task-1",
        layout: "board",
      }),
    ],
    [
      "calendar",
      projectViewRoutes.projectCalendar.build(params, { taskId: "task-1" }),
    ],
    [
      "gantt",
      projectViewRoutes.projectGantt.build(params, { taskId: "task-1" }),
    ],
    [
      "list",
      projectViewRoutes.projectBoard.build(params, {
        taskId: "task-1",
        layout: "list",
      }),
    ],
  ] satisfies [ProjectView, string][])(
    "VW-4: switching to %s preserves the complete query string",
    (view, expectedUrl) => {
      const actual = new URL(
        buildProjectViewSwitchUrl(view, params, "?taskId=task-1&unused=value"),
        "https://taskdesk.test",
      );
      const expected = new URL(expectedUrl, "https://taskdesk.test");
      expect(actual.pathname).toBe(expected.pathname);
      expect(actual.searchParams.get("taskId")).toBe("task-1");
      expect(actual.searchParams.get("unused")).toBe("value");
      if (view === "board" || view === "list")
        expect(actual.searchParams.get("layout")).toBe(view);
    },
  );

  it("VW-4: omits task selection when no task panel is open", () => {
    expect(buildProjectViewSwitchUrl("board", params, "?layout=list")).toBe(
      projectViewRoutes.projectBoard.build(params, { layout: "board" }),
    );
  });

  it.each(["backlog", "board", "calendar", "gantt", "list"] as const)(
    "VW-1: %s shortcut retains filters, search, sort, task panel, and month",
    (view) => {
      const navigate = vi.fn();
      const onLayoutChange = vi.fn();
      const handlers = createProjectViewShortcutHandlers(
        params,
        "?taskId=task-1&status=todo&labels=label-1&q=urgent&sort=priority&dir=desc&month=2026-10",
        navigate,
        onLayoutChange,
      );

      handlers[view]();

      const href = navigate.mock.calls[0]?.[0];
      const parsed = href ? new URL(href, "https://taskdesk.test") : null;
      expect(parsed?.searchParams.get("taskId")).toBe("task-1");
      expect(parsed?.searchParams.get("status")).toBe("todo");
      expect(parsed?.searchParams.get("labels")).toBe("label-1");
      expect(parsed?.searchParams.get("q")).toBe("urgent");
      expect(parsed?.searchParams.get("sort")).toBe("priority");
      expect(parsed?.searchParams.get("dir")).toBe("desc");
      expect(parsed?.searchParams.get("month")).toBe("2026-10");
      if (view === "board" || view === "list") {
        expect(onLayoutChange).toHaveBeenCalledExactlyOnceWith(view);
      } else {
        expect(onLayoutChange).not.toHaveBeenCalled();
      }
    },
  );

  it("VW-4: Gantt task selection round-trips through its canonical route builder", () => {
    const url = projectViewRoutes.projectGantt.build(params, {
      taskId: "task/one",
    });
    expect(projectViewRoutes.projectGantt.parse(url)).toEqual({
      params,
      search: { taskId: "task/one" },
    });
  });

  it.each([
    [
      "backlog",
      projectViewRoutes.projectBacklog.build(params, {
        taskId: "task-1",
        month: "2026-10",
      }),
    ],
    [
      "board",
      projectViewRoutes.projectBoard.build(params, {
        taskId: "task-1",
        layout: "board",
        month: "2026-10",
      }),
    ],
    [
      "calendar",
      projectViewRoutes.projectCalendar.build(params, {
        taskId: "task-1",
        month: "2026-10",
      }),
    ],
    [
      "gantt",
      projectViewRoutes.projectGantt.build(params, {
        taskId: "task-1",
        month: "2026-10",
      }),
    ],
    [
      "list",
      projectViewRoutes.projectBoard.build(params, {
        taskId: "task-1",
        layout: "list",
        month: "2026-10",
      }),
    ],
  ] satisfies [ProjectView, string][])(
    "VW-4: the %s keyboard view shortcut navigates with the selected task",
    (view, expectedUrl) => {
      const navigate = vi.fn();
      const handlers = createProjectViewShortcutHandlers(
        params,
        "?taskId=task-1&month=2026-10",
        navigate,
      );

      handlers[view]();

      const href = navigate.mock.calls[0]?.[0];
      expect(navigate).toHaveBeenCalledOnce();
      expect(href && new URL(href, "https://taskdesk.test").pathname).toBe(
        new URL(expectedUrl, "https://taskdesk.test").pathname,
      );
      const query = new URLSearchParams(href?.split("?")[1]);
      expect(query.get("taskId")).toBe("task-1");
      expect(query.get("month")).toBe("2026-10");
      if (view === "board" || view === "list")
        expect(query.get("layout")).toBe(view);
    },
  );
});
