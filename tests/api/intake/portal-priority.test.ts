/** CP-7: escalate-only priority arithmetic (DB-free). */
import { describe, expect, it } from "vitest";
import {
  judgeEscalation,
  priorityRank,
  raisablePriorities,
} from "../../../apps/api/src/intake/portal-priority";

describe("portal priority escalation (CP-7)", () => {
  it("ranks no priority below low", () => {
    expect(priorityRank(null)).toBeLessThan(priorityRank("low"));
    expect(priorityRank("low")).toBeLessThan(priorityRank("medium"));
    expect(priorityRank("high")).toBeLessThan(priorityRank("urgent"));
  });

  it("permits any strictly increasing change, including the first priority", () => {
    expect(judgeEscalation(null, "low")).toBe("raise");
    expect(judgeEscalation("low", "urgent")).toBe("raise");
    expect(judgeEscalation("medium", "high")).toBe("raise");
  });

  it("refuses every decrease and flags an equal value", () => {
    for (const [from, to] of [
      ["urgent", "high"],
      ["high", "low"],
      ["medium", "low"],
    ] as const)
      expect(judgeEscalation(from, to)).toBe("lower");
    expect(judgeEscalation("high", "high")).toBe("same");
    expect(judgeEscalation(null, "low")).not.toBe("lower");
  });

  it("offers only higher priorities, none at urgent", () => {
    expect(raisablePriorities(null)).toEqual([
      "low",
      "medium",
      "high",
      "urgent",
    ]);
    expect(raisablePriorities("medium")).toEqual(["high", "urgent"]);
    expect(raisablePriorities("urgent")).toEqual([]);
  });
});
