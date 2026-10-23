import { describe, expect, it } from "vitest";
import { compositionWarnings } from "../../../apps/api/src/project/composition";

describe("project composition warnings (PR-6, PR-7, PR-10)", () => {
  it("warns about everything on a bare project", () => {
    expect(
      compositionWarnings({ managerId: null, startDate: null, memberCount: 0 }),
    ).toEqual(["PR-6", "PR-7", "PR-10"]);
  });

  it("clears each rule as it is satisfied", () => {
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: null,
        memberCount: 0,
      }),
    ).toEqual(["PR-7", "PR-10"]);
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: "2026-01-01",
        memberCount: 0,
      }),
    ).toEqual(["PR-7"]);
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: "2026-01-01",
        memberCount: 1,
      }),
    ).toEqual([]);
  });

  it("does not require an end date", () => {
    expect(
      compositionWarnings({
        managerId: "p1",
        startDate: "2026-01-01",
        memberCount: 3,
      }),
    ).toEqual([]);
  });
});
