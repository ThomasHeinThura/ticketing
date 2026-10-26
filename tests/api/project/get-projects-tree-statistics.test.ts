import { describe, expect, it } from "vitest";
import { aggregateVisibleTreeStatistics } from "../../../apps/api/src/project/controllers/get-projects";

describe("aggregateVisibleTreeStatistics (PR-5)", () => {
  it("aggregates root and readable descendants with exact completed counts", () => {
    const dueDate = new Date("2026-10-20T00:00:00.000Z");
    const result = aggregateVisibleTreeStatistics(
      new Map([
        ["root", ["root", "child", "grandchild", "hidden-child"]],
        ["child", ["child", "grandchild"]],
      ]),
      ["root", "child", "grandchild"],
      new Map([
        [
          "root",
          {
            totalTasks: 3,
            completedTasks: 1,
            completionPercentage: 33,
            dueDate: null,
          },
        ],
        [
          "child",
          {
            totalTasks: 2,
            completedTasks: 1,
            completionPercentage: 50,
            dueDate,
          },
        ],
        [
          "grandchild",
          {
            totalTasks: 1,
            completedTasks: 1,
            completionPercentage: 100,
            dueDate: null,
          },
        ],
      ]),
    );

    expect(result.get("root")).toEqual({
      totalTasks: 6,
      completionPercentage: 50,
      dueDate,
    });
    expect(result.get("child")).toEqual({
      totalTasks: 3,
      completionPercentage: 67,
      dueDate,
    });
  });

  it("omits the aggregate when there is no eligible descendant", () => {
    const result = aggregateVisibleTreeStatistics(
      new Map([["root", ["root", "hidden-child"]]]),
      ["root"],
      new Map([
        [
          "root",
          {
            totalTasks: 2,
            completedTasks: 1,
            completionPercentage: 50,
            dueDate: null,
          },
        ],
      ]),
    );

    expect(result.has("root")).toBe(false);
  });

  it("does not include project IDs outside the subtree or readable set", () => {
    const result = aggregateVisibleTreeStatistics(
      new Map([["root", ["root", "child"]]]),
      ["root", "child", "foreign"],
      new Map([
        [
          "root",
          {
            totalTasks: 1,
            completedTasks: 0,
            completionPercentage: 0,
            dueDate: null,
          },
        ],
        [
          "child",
          {
            totalTasks: 2,
            completedTasks: 2,
            completionPercentage: 100,
            dueDate: null,
          },
        ],
        [
          "foreign",
          {
            totalTasks: 100,
            completedTasks: 100,
            completionPercentage: 100,
            dueDate: new Date("2020-01-01T00:00:00.000Z"),
          },
        ],
      ]),
    );

    expect(result.get("root")).toEqual({
      totalTasks: 3,
      completionPercentage: 67,
      dueDate: null,
    });
  });
});
