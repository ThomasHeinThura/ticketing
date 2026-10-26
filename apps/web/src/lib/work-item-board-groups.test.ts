import { describe, expect, it } from "vitest";
import type { WorkItemRow } from "@/types/work-item";
import {
  boardGroupId,
  boardGroupItemId,
  buildBoardGroups,
  itemGroupValue,
  itemGroupValues,
  parseBoardGroupId,
  parseBoardGroupItemId,
} from "./work-item-board-groups";

function groupWithValue(
  groups: ReturnType<typeof buildBoardGroups>,
  value: unknown,
) {
  const group = groups.find((candidate) => candidate.value === value);
  if (!group) throw new Error(`Missing group for ${String(value)}`);
  return group;
}

function row(
  id: string,
  over: Partial<
    Pick<
      WorkItemRow,
      | "assigneeId"
      | "assigneeName"
      | "priority"
      | "labels"
      | "customFieldValues"
    >
  >,
) {
  return {
    id,
    key: `T-${id}`,
    assigneeId: null,
    assigneeName: null,
    priority: null,
    labels: [],
    customFieldValues: {},
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
    expect(
      parseBoardGroupId(boardGroupId("cf.customer_impact", "high:urgent")),
    ).toEqual({ field: "cf.customer_impact", value: "high:urgent" });
    expect(
      parseBoardGroupId(boardGroupId("label", "label:with:colon")),
    ).toEqual({ field: "label", value: "label:with:colon" });
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
    const unknown = groups.find((group) => group.value === "critical");
    expect(unknown).toMatchObject({ value: "critical", droppable: false });
    expect(unknown?.items).toHaveLength(1);
  });

  it("groups by assignee with every assignable person and the unassigned bucket last", () => {
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
      "p1",
      "p2",
      "gone",
      null,
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      "Ann",
      "Bo",
      "Former",
      null,
    ]);
    expect(groups.map((group) => group.droppable)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["1"]);
    expect(groups[2].items.map((item) => item.id)).toEqual(["3"]);
    expect(groups[3].items.map((item) => item.id)).toEqual(["2"]);
  });

  it("puts none last for priority and keeps unavailable priority buckets visible", () => {
    const groups = buildBoardGroups("priority", [
      row("1", { priority: "critical" as never }),
      row("2", { priority: null }),
    ]);
    expect(groups.at(-1)?.value).toBeNull();
    expect(groups.find((group) => group.value === "critical")).toMatchObject({
      droppable: false,
      items: [expect.objectContaining({ id: "1" })],
    });
  });

  it("groups an item into every assigned label and gives duplicate cards distinct sortable ids", () => {
    const item = row("1", {
      labels: [
        { id: "triage:needed", name: "Triage", color: "blue" },
        { id: "customer", name: "Customer", color: "green" },
      ],
    });
    const groups = buildBoardGroups(
      "label",
      [item, row("2", { labels: [] })],
      [],
      undefined,
      [],
      [
        { id: "triage:needed", name: "Triage", color: "blue" },
        { id: "customer", name: "Customer", color: "green" },
      ],
    );
    const triage = groups.find((group) => group.value === "triage:needed");
    const customer = groups.find((group) => group.value === "customer");
    expect(triage?.items.map((entry) => entry.id)).toEqual(["1"]);
    expect(customer?.items.map((entry) => entry.id)).toEqual(["1"]);
    expect(groups.at(-1)?.value).toBeNull();
    const first = boardGroupItemId(
      groupWithValue(groups, "triage:needed"),
      item.id,
    );
    const second = boardGroupItemId(
      groupWithValue(groups, "customer"),
      item.id,
    );
    expect(first).not.toBe(second);
    expect(parseBoardGroupItemId(first)).toEqual({
      groupId: triage?.id,
      itemId: item.id,
    });
  });

  it("groups a multi-select value into every option, ordered by its configured keys", () => {
    const field = {
      key: "impact",
      name: "Impact",
      format: "multi_select" as const,
      options: [
        { key: "critical", label: "Critical" },
        { key: "major", label: "Major" },
        { key: "minor", label: "Minor" },
      ],
    };
    const groups = buildBoardGroups(
      "cf.impact",
      [
        row("1", { customFieldValues: { impact: ["major", "critical"] } }),
        row("2", { customFieldValues: { impact: [] } }),
        row("3", { customFieldValues: {} }),
      ],
      [],
      field,
    );
    expect(groups.map((group) => group.value)).toEqual([
      "critical",
      "major",
      "minor",
      undefined,
      null,
    ]);
    expect(groups[0].items.map((entry) => entry.id)).toEqual(["1"]);
    expect(groups[1].items.map((entry) => entry.id)).toEqual(["1"]);
    expect(groups[3]).toMatchObject({ droppable: false, items: [{ id: "3" }] });
    expect(groups.at(-1)).toMatchObject({ items: [{ id: "2" }] });
    expect(
      itemGroupValues(
        row("1", { customFieldValues: { impact: ["a", "b"] } }),
        "cf.impact",
        field,
      ),
    ).toEqual(["a", "b"]);
  });

  it("orders boolean, numeric, date, and natural text scalar groups deterministically", () => {
    const booleanField = {
      key: "approved",
      name: "Approved",
      format: "boolean" as const,
      options: [],
    };
    const booleans = buildBoardGroups(
      "cf.approved",
      [
        row("yes", { customFieldValues: { approved: true } }),
        row("no", { customFieldValues: { approved: false } }),
      ],
      [],
      booleanField,
    );
    expect(booleans.map((group) => group.value)).toEqual([true, false, null]);

    const numberField = {
      key: "score",
      name: "Score",
      format: "number" as const,
      options: [],
    };
    const numbers = buildBoardGroups(
      "cf.score",
      [
        row("ten", { customFieldValues: { score: 10 } }),
        row("two", { customFieldValues: { score: 2 } }),
      ],
      [],
      numberField,
    );
    expect(numbers.map((group) => group.value)).toEqual([2, 10, null]);

    const dateField = {
      key: "due",
      name: "Due",
      format: "date" as const,
      options: [],
    };
    const dates = buildBoardGroups(
      "cf.due",
      [
        row("later", { customFieldValues: { due: "2026-12-01" } }),
        row("earlier", { customFieldValues: { due: "2026-02-01" } }),
      ],
      [],
      dateField,
    );
    expect(dates.map((group) => group.value)).toEqual([
      "2026-02-01",
      "2026-12-01",
      null,
    ]);

    const textField = {
      key: "code",
      name: "Code",
      format: "text" as const,
      options: [],
    };
    const textGroups = buildBoardGroups(
      "cf.code",
      [
        row("ten", { customFieldValues: { code: "Item 10" } }),
        row("two", { customFieldValues: { code: "Item 2" } }),
      ],
      [],
      textField,
    );
    expect(textGroups.map((group) => group.value)).toEqual([
      "Item 2",
      "Item 10",
      null,
    ]);
  });

  it("keeps the API order inside a group", () => {
    const groups = buildBoardGroups("priority", [
      row("b", { priority: "high" }),
      row("a", { priority: "high" }),
    ]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
