import { describe, expect, it } from "vitest";
import {
  moveStateToPosition,
  templateHasOutboundTransition,
} from "../../../apps/api/src/project/state-guard";

describe("PR-17 template guard (WF-2)", () => {
  it("accepts a template that is the from side of a transition", () => {
    expect(templateHasOutboundTransition("t1", ["t2", "t1"])).toBe(true);
  });

  it("treats a null from (any state, WF-5) as an outbound transition for every template", () => {
    expect(templateHasOutboundTransition("t1", [null])).toBe(true);
  });

  it("refuses a template with no outbound transition", () => {
    expect(templateHasOutboundTransition("t1", ["t2", "t3"])).toBe(false);
    expect(templateHasOutboundTransition("t1", [])).toBe(false);
  });
});

describe("project state ordering", () => {
  it("moves a state and clamps the position", () => {
    expect(moveStateToPosition(["a", "b", "c"], "c", 0)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveStateToPosition(["a", "b", "c"], "a", 99)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(moveStateToPosition(["a", "b", "c"], "b", 1)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns null for an unknown state", () => {
    expect(moveStateToPosition(["a"], "z", 0)).toBeNull();
  });
});
