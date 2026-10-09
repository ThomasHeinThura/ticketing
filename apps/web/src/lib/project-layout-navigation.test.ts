import { describe, expect, it, vi } from "vitest";
import {
  buildProjectViewSwitchUrl,
  createProjectViewShortcutHandlers,
  type ProjectView,
} from "./project-layout-navigation";
import { routes } from "./routes";

describe("project layout navigation", () => {
  const params = { workspaceId: "workspace-1", projectId: "project-1" };

  it.each([
    ["backlog", routes.projectBacklog.build(params, { taskId: "task-1" })],
    [
      "board",
      routes.projectBoard.build(params, { taskId: "task-1", layout: "board" }),
    ],
    ["calendar", routes.projectCalendar.build(params, { taskId: "task-1" })],
    ["gantt", routes.projectGantt.build(params, { taskId: "task-1" })],
    [
      "list",
      routes.projectBoard.build(params, { taskId: "task-1", layout: "list" }),
    ],
  ] satisfies [ProjectView, string][])(
    "VW-4: switching to %s keeps the selected task addressable",
    (view, expectedUrl) => {
      expect(
        buildProjectViewSwitchUrl(view, params, "?taskId=task-1&unused=value"),
      ).toBe(expectedUrl);
    },
  );

  it("VW-4: omits task selection when no task panel is open", () => {
    expect(buildProjectViewSwitchUrl("board", params, "?layout=list")).toBe(
      routes.projectBoard.build(params, { layout: "board" }),
    );
  });

  it("VW-4: Gantt task selection round-trips through its canonical route builder", () => {
    const url = routes.projectGantt.build(params, { taskId: "task/one" });
    expect(routes.projectGantt.parse(url)).toEqual({
      params,
      search: { taskId: "task/one" },
    });
  });

  it.each([
    ["backlog", routes.projectBacklog.build(params, { taskId: "task-1" })],
    [
      "board",
      routes.projectBoard.build(params, { taskId: "task-1", layout: "board" }),
    ],
    ["calendar", routes.projectCalendar.build(params, { taskId: "task-1" })],
    ["gantt", routes.projectGantt.build(params, { taskId: "task-1" })],
    [
      "list",
      routes.projectBoard.build(params, { taskId: "task-1", layout: "list" }),
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

      expect(navigate).toHaveBeenCalledExactlyOnceWith(expectedUrl);
    },
  );
});
