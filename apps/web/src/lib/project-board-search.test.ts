import { describe, expect, it } from "vitest";
import {
  appendProjectViewSearchParams,
  parseProjectBacklogSearch,
  parseProjectBoardSearch,
  parseProjectViewSearchFromParams,
} from "./project-board-search";
import {
  resolveProjectBoardLayout,
  withProjectBoardLayout,
  withProjectBoardTask,
} from "./project-board-search-state";

describe("project board URL state", () => {
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
