import { describe, expect, it, vi } from "vitest";
import {
  buildProjectViewSwitchUrl,
  createProjectViewShortcutHandlers,
  type ProjectView,
} from "./project-layout-navigation";
import { projectViewRoutes } from "./project-view-routes";

describe("project layout navigation", () => {
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
