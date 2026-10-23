import { describe, expect, it } from "vitest";
import type { WorkItemRow } from "@/types/work-item";
import {
  boardGroupId,
  buildBoardGroups,
  itemGroupValue,
  parseBoardGroupId,
} from "./work-item-board-groups";

function row(
  id: string,
  over: Partial<Pick<WorkItemRow, "assigneeId" | "assigneeName" | "priority">>,
) {
  return {
    id,
    key: `T-${id}`,
    assigneeId: null,
    assigneeName: null,
    priority: null,
    ...over,
  } as WorkItemRow;
}

describe("board group ids", () => {
  it("round-trips and cannot collide with a state or item id", () => {
    expect(parseBoardGroupId(boardGroupId("assignee", "p1"))).toEqual({
      field: "assignee",
      value: "p1",
    });
    expect(parseBoardGroupId(boardGroupId("priority", null))).toEqual({
      field: "priority",
      value: null,
    });
    expect(parseBoardGroupId("state-1")).toBeUndefined();
    expect(parseBoardGroupId("group:state:x")).toBeUndefined();
    expect(parseBoardGroupId(undefined)).toBeUndefined();
  });

  it("reads the grouped field of a row", () => {
    expect(itemGroupValue(row("1", { priority: "high" }), "priority")).toBe(
      "high",
    );
    expect(itemGroupValue(row("1", { assigneeId: "p1" }), "assignee")).toBe(
      "p1",
    );
  });
});

describe("buildBoardGroups", () => {
  it("groups by priority in urgent-to-low order with an always-present empty bucket", () => {
    const groups = buildBoardGroups("priority", [
      row("1", { priority: "low" }),
      row("2", { priority: "urgent" }),
      row("3", { priority: null }),
      row("4", { priority: "low" }),
    ]);
    expect(groups.map((group) => group.value)).toEqual([
      "urgent",
      "high",
      "medium",
      "low",
      null,
    ]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["2"],
      [],
      [],
      ["1", "4"],
      ["3"],
    ]);
    expect(groups.every((group) => group.droppable)).toBe(true);
  });

  it("keeps an unknown priority visible but not a drop target", () => {
    const groups = buildBoardGroups("priority", [
      row("1", { priority: "critical" as never }),
    ]);
    const unknown = groups.at(-1);
    expect(unknown).toMatchObject({ value: "critical", droppable: false });
    expect(unknown?.items).toHaveLength(1);
  });

  it("groups by assignee with the unassigned bucket first and every assignable person", () => {
    const groups = buildBoardGroups(
      "assignee",
      [
        row("1", { assigneeId: "p2", assigneeName: "Bo" }),
        row("2", { assigneeId: null }),
        row("3", { assigneeId: "gone", assigneeName: "Former" }),
      ],
      [
        { personId: "p1", name: "Ann" },
        { personId: "p2", name: "Bo" },
        { personId: "p1", name: "Ann again" },
      ],
    );
    expect(groups.map((group) => group.value)).toEqual([
      null,
      "p1",
      "p2",
      "gone",
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      null,
      "Ann",
      "Bo",
      "Former",
    ]);
    expect(groups.map((group) => group.droppable)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(groups[2].items.map((item) => item.id)).toEqual(["1"]);
    expect(groups[3].items.map((item) => item.id)).toEqual(["3"]);
  });

  it("keeps the API order inside a group", () => {
    const groups = buildBoardGroups("priority", [
      row("b", { priority: "high" }),
      row("a", { priority: "high" }),
    ]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
