import { describe, expect, it } from "vitest";
import type { MembershipGrantCandidate } from "./membership-projection.js";
import { projectEffectiveMembership } from "./membership-projection.js";

function grant(
  id: string,
  sourceKind: MembershipGrantCandidate["sourceKind"],
  roleId: string,
  roleRank: number,
  seesAll = false,
): MembershipGrantCandidate {
  return { id, sourceKind, roleId, roleRank, seesAll };
}

describe("IP-22: single effective membership projection", () => {
  it("gives a direct grant precedence over higher-ranked external grants", () => {
    expect(
      projectEffectiveMembership([
        grant("direct", "direct", "member", 1, true),
        grant("scim", "scim_group", "manager", 80),
      ]),
    ).toEqual({
      kind: "projected",
      roleId: "member",
      seesAll: true,
      sourceKind: "direct",
      grantId: "direct",
    });
  });

  it("chooses the highest external rank without unioning roles", () => {
    expect(
      projectEffectiveMembership([
        grant("jit", "jit_default", "member", 10),
        grant("scim", "scim_group", "manager", 30),
      ]),
    ).toMatchObject({ kind: "projected", roleId: "manager", seesAll: false });
  });

  it("fails closed on equal-rank different-role ties and multiple direct rows", () => {
    expect(
      projectEffectiveMembership([
        grant("one", "oidc_group", "manager", 30),
        grant("two", "scim_group", "admin", 30),
      ]),
    ).toEqual({ kind: "conflict", reason: "equal_rank_roles" });
    expect(
      projectEffectiveMembership([
        grant("one", "direct", "manager", 30),
        grant("two", "direct", "admin", 90),
      ]),
    ).toEqual({ kind: "conflict", reason: "multiple_direct" });
  });

  it("uses SCIM over OIDC over JIT only when the role is identical", () => {
    expect(
      projectEffectiveMembership([
        grant("jit", "jit_default", "member", 30),
        grant("oidc", "oidc_group", "member", 30),
        grant("scim", "scim_group", "member", 30),
      ]),
    ).toMatchObject({ sourceKind: "scim_group", grantId: "scim" });
  });

  it("rejects external sees_all, duplicate evidence and invalid ranks", () => {
    expect(
      projectEffectiveMembership([
        grant("external", "scim_group", "role", 2, true),
      ]),
    ).toEqual({ kind: "invalid" });
    expect(
      projectEffectiveMembership([
        grant("duplicate", "direct", "role", 2),
        grant("duplicate", "direct", "role", 2),
      ]),
    ).toEqual({ kind: "invalid" });
    expect(
      projectEffectiveMembership([grant("bad", "direct", "role", Number.NaN)]),
    ).toEqual({ kind: "invalid" });
  });
});
