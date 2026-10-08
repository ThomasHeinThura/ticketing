import { describe, expect, it } from "vitest";
import {
  parseProjectBoardSearch,
  resolveProjectBoardLayout,
  withProjectBoardLayout,
  withProjectBoardTask,
} from "./project-board-search";

describe("project board URL state", () => {
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
