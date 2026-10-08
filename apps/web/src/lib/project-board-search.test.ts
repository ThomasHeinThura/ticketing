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
});
