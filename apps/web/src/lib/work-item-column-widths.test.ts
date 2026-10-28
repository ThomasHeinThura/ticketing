import { describe, expect, it } from "vitest";
import { parseTableColumnWidths } from "./work-item-column-widths";

describe("work item column width preferences", () => {
  it("accepts only registered integer widths within the persisted range", () => {
    expect(
      parseTableColumnWidths({ title: 320, key: 64, "cf.constructor": 128 }),
    ).toEqual({ title: 320, key: 64, "cf.constructor": 128 });
    expect(parseTableColumnWidths({})).toEqual({});
    for (const invalid of [
      null,
      [],
      { title: 63 },
      { title: 801 },
      { title: 100.5 },
      { title: "120" },
      { unknown: 120 },
      { "cf.Bad Key": 120 },
    ]) {
      expect(parseTableColumnWidths(invalid)).toBeUndefined();
    }
  });

  it("rejects more entries than the registered preference limit", () => {
    const oversized = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`title-${index}`, 120]),
    );
    expect(parseTableColumnWidths(oversized)).toBeUndefined();
  });
});
