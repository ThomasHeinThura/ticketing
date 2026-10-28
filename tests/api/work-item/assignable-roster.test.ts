import { describe, expect, it } from "vitest";
import { dedupeRoster } from "../../../apps/api/src/work-item/controllers/list-assignable-people";

const row = (
  personId: string,
  scopeId: string,
  roleRank: number,
  roleName = `r${roleRank}`,
) => ({ personId, scopeId, roleRank, roleName, name: personId });

describe("assignable roster inclusion of ancestor members (PR-2, review Q2)", () => {
  it("includes a parent-only member and marks them inherited", () => {
    const roster = dedupeRoster([row("pa", "parent", 40)], "child");
    expect(roster.get("pa")).toMatchObject({ inherited: true });
  });

  it("marks a direct member as not inherited", () => {
    const roster = dedupeRoster([row("pb", "child", 20)], "child");
    expect(roster.get("pb")).toMatchObject({ inherited: false });
  });

  it("a direct row wins over a stronger inherited row (explicit override, PR-3)", () => {
    const roster = dedupeRoster(
      [row("pc", "parent", 50, "lead"), row("pc", "child", 20, "viewer")],
      "child",
    );
    expect(roster.get("pc")).toMatchObject({
      roleName: "viewer",
      inherited: false,
    });
  });

  it("among inherited rows the strongest role wins", () => {
    const roster = dedupeRoster(
      [row("pd", "gp", 20, "low"), row("pd", "parent", 40, "high")],
      "child",
    );
    expect(roster.get("pd")?.roleName).toBe("high");
  });
});
