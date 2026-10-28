import { describe, expect, it } from "vitest";
import { buildGanttRows, GANTT_UNASSIGNED_GROUP_ID } from "./gantt-groups";

const tasks = [
  { id: "1", assigneeId: "p2", assigneeName: "Bo" },
  { id: "2", assigneeId: null, assigneeName: null },
  { id: "3", assigneeId: "p1", assigneeName: "Ann" },
  { id: "4", assigneeId: "p2", assigneeName: "Bo" },
];

describe("buildGanttRows (VW-27)", () => {
  it("returns the tasks untouched without a grouping", () => {
    const rows = buildGanttRows(tasks, "none");
    expect(rows.every((row) => row.kind === "task")).toBe(true);
    expect(rows.map((row) => (row.kind === "task" ? row.task.id : ""))).toEqual(
      ["1", "2", "3", "4"],
    );
  });

  it("groups by assignee: names alphabetical, unassigned last, bars keep their order", () => {
    const rows = buildGanttRows(tasks, "assignee");
    expect(
      rows.map((row) =>
        row.kind === "group"
          ? `#${row.name ?? "none"}(${row.count})`
          : row.task.id,
      ),
    ).toEqual(["#Ann(1)", "3", "#Bo(2)", "1", "4", "#none(1)", "2"]);
    const last = rows.filter((row) => row.kind === "group").at(-1);
    expect(last).toMatchObject({ id: GANTT_UNASSIGNED_GROUP_ID, name: null });
  });

  it("gives an empty list no rows and never invents a heading", () => {
    expect(buildGanttRows([], "assignee")).toEqual([]);
  });

  it("groups by module with names from the module list, no-module last", () => {
    const rows = buildGanttRows(
      [
        { id: "1", moduleId: "m2" },
        { id: "2", moduleId: null },
        { id: "3", moduleId: "m1" },
        { id: "4", moduleId: "gone" },
      ],
      "module",
      new Map([
        ["m1", "Checkout"],
        ["m2", "Basket"],
      ]),
    );
    expect(
      rows.map((row) =>
        row.kind === "group"
          ? `#${row.by}:${row.name ?? "none"}(${row.count})`
          : row.task.id,
      ),
    ).toEqual([
      "#module:none(1)", // a module id with no known name keeps its own heading
      "4",
      "#module:Basket(1)",
      "1",
      "#module:Checkout(1)",
      "3",
      "#module:none(1)", // the no-module bucket is last
      "2",
    ]);
  });

  it("groups by the server-resolved epic, including an epic root itself", () => {
    const rows = buildGanttRows(
      [
        {
          id: "child",
          epic: { id: "epic-a", key: "PRJ-1", title: "Launch" },
          epicAvailable: true,
        },
        {
          id: "root",
          epic: { id: "epic-a", key: "PRJ-1", title: "Launch" },
          epicAvailable: true,
        },
        { id: "none", epic: null, epicAvailable: true },
      ],
      "epic",
    );

    expect(
      rows.map((row) =>
        row.kind === "group"
          ? `#${row.name ?? "none"}(${row.count})`
          : row.task.id,
      ),
    ).toEqual(["#Launch(2)", "child", "root", "#none(1)", "none"]);
  });

  it("keeps unavailable ancestry distinct and places it before the None bucket", () => {
    const rows = buildGanttRows(
      [
        { id: "unavailable", epic: null, epicAvailable: false },
        { id: "none", epic: null, epicAvailable: true },
      ],
      "epic",
    );

    expect(rows).toMatchObject([
      { kind: "group", id: "gantt-group:epic:unavailable", unavailable: true },
      { kind: "task", task: { id: "unavailable" } },
      { kind: "group", id: GANTT_UNASSIGNED_GROUP_ID },
      { kind: "task", task: { id: "none" } },
    ]);
  });
});
