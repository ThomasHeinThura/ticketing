import { describe, expect, it } from "vitest";
import { validateCustomQuery } from "../../../apps/api/src/report/custom";
import { parseEpicDrillHandle } from "../../../apps/api/src/report/epic-rollup";

describe("tier 3 epic reporting handles", () => {
  it("accepts epic grouping only for work items", () => {
    expect(
      validateCustomQuery({ entity: "work_item", groupBy: "epic" }),
    ).toBeNull();
    expect(validateCustomQuery({ entity: "time_entry", groupBy: "epic" })).toBe(
      "unsupported_group",
    );
  });

  it("parses only bounded opaque epic and typed special handles", () => {
    expect(parseEpicDrillHandle("epic:cjldemo123")).toEqual({
      kind: "epic",
      id: "cjldemo123",
    });
    expect(parseEpicDrillHandle("epic-none")).toEqual({ kind: "none" });
    expect(parseEpicDrillHandle("epic-unavailable")).toEqual({
      kind: "unavailable",
    });
    expect(parseEpicDrillHandle("Epic:foreign")).toBeNull();
    expect(parseEpicDrillHandle("epic:bad/id")).toBeNull();
    expect(parseEpicDrillHandle(`epic:${"a".repeat(129)}`)).toBeNull();
  });
});
