import { describe, expect, it } from "vitest";
import {
  parseWorkItemFilterText,
  printWorkItemFilterText,
} from "./work-item-filter";
import {
  chipValues,
  fromChips,
  toChips,
  withOperator,
  withValues,
} from "./work-item-filter-chips";

const chips = (text: string) => toChips(parseWorkItemFilterText(text));

describe("work item filter chips", () => {
  it("maps no filter to no chips and one leaf to one chip", () => {
    expect(chips("")).toEqual([]);
    expect(chips("priority:high")).toEqual([
      { field: "priority", op: "eq", value: "high" },
    ]);
  });

  it("round-trips a flat AND through the printed text", () => {
    const leaves = chips("priority:in(high,urgent) due:<7d assignee:@me") ?? [];
    expect(leaves).toHaveLength(3);
    const text = printWorkItemFilterText(fromChips(leaves));
    expect(chips(text)).toEqual(leaves);
    expect(fromChips([])).toBeUndefined();
    expect(printWorkItemFilterText(fromChips(leaves.slice(0, 1)))).toBe(
      "priority:in(high,urgent)",
    );
  });

  it.each([
    "priority:high OR state:started",
    "AND(priority:high,AND(state:started,OR(assignee:@me,priority:low)))",
    "label:bug",
    "cf.asset:x priority:high",
  ])("reports %s as not representable", (text) => {
    expect(chips(text)).toBeNull();
  });

  it("derives eq or in from the picked values and removes an emptied chip", () => {
    const [leaf] = chips("priority:high") ?? [];
    if (!leaf) throw new Error("no chip");
    expect(withValues(leaf, ["high", "urgent"])).toEqual({
      field: "priority",
      op: "in",
      value: ["high", "urgent"],
    });
    expect(withValues(leaf, ["low"])).toEqual({
      field: "priority",
      op: "eq",
      value: "low",
    });
    expect(withValues(leaf, [])).toBeUndefined();
  });

  it("keeps one scalar when the operator leaves in", () => {
    const [leaf] = chips("priority:in(high,urgent)") ?? [];
    if (!leaf) throw new Error("no chip");
    expect(withOperator(leaf, "gte")).toEqual({
      field: "priority",
      op: "gte",
      value: "high",
    });
    expect(chipValues(withOperator(leaf, "in"))).toEqual(["high", "urgent"]);
  });
});
