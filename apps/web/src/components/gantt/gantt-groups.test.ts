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
});
