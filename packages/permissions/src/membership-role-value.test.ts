import { describe, expect, it } from "vitest";
import {
  isSingleMembershipRole,
  legacyMembershipRoleSegments,
  MEMBERSHIP_ROLE_SEPARATOR,
  membershipRoleProblem,
  repairableMembershipRole,
} from "./membership-role-value.js";

describe("membershipRoleProblem", () => {
  it("accepts exactly one trimmed, non-empty role name", () => {
    for (const value of ["owner", "admin", "member", "viewer", "team lead"]) {
      expect(membershipRoleProblem(value), value).toBeNull();
      expect(isSingleMembershipRole(value), value).toBe(true);
    }
  });

  it("rejects every comma-bearing shape as multi-valued, including the ones that name only one role", () => {
    // The trailing-comma and duplicate cases matter because a reader who thinks "well, it
    // still only means admin" would be reasoning about the value the way NEITHER evaluator
    // does: better-auth splits first (`permission.mjs:4`) and gets two pieces, and the
    // native side matches the whole string and gets none.
    for (const value of [
      "owner,admin",
      "admin,viewer",
      "member,owner",
      "admin,",
      ",admin",
      "admin,admin",
      "admin, viewer",
      " admin , viewer ",
      ",",
    ]) {
      expect(membershipRoleProblem(value), value).toBe("multi-valued");
      expect(isSingleMembershipRole(value), value).toBe(false);
    }
  });

  it("rejects padding, and reports a whitespace-only value as empty rather than untrimmed", () => {
    expect(membershipRoleProblem(" admin")).toBe("untrimmed");
    expect(membershipRoleProblem("admin ")).toBe("untrimmed");
    expect(membershipRoleProblem("\tadmin\n")).toBe("untrimmed");
    expect(membershipRoleProblem("")).toBe("empty");
    expect(membershipRoleProblem("   ")).toBe("empty");
  });

  it("treats tab and newline padding the same as space padding -- migration 0050's CHECK must agree on exactly this shape (Finding 3): a one-argument `btrim` strips only the space character and would have called these well-formed", () => {
    expect(membershipRoleProblem("\tadmin")).toBe("untrimmed");
    expect(membershipRoleProblem("admin\n")).toBe("untrimmed");
    expect(membershipRoleProblem("\t")).toBe("empty");
    expect(membershipRoleProblem("\n")).toBe("empty");
  });

  it("reports the multi-valued problem in preference to the untrimmed one, because that is the half with a privilege consequence", () => {
    expect(membershipRoleProblem(" admin,viewer")).toBe("multi-valued");
  });

  it("does not reject a role name that merely CONTAINS a known role name", () => {
    // "downloader" contains "owner" as a substring. The plugin's own `isCreator` check is a
    // `.split(",").includes("owner")`, not a substring test, so a name like this is not the
    // defect and must not be swept up by a rule aimed at cardinality.
    expect(membershipRoleProblem("downloader")).toBeNull();
    expect(membershipRoleProblem("co-owner")).toBeNull();
  });

  it("names the separator rather than assuming it", () => {
    expect(MEMBERSHIP_ROLE_SEPARATOR).toBe(",");
  });
});

describe("legacyMembershipRoleSegments", () => {
  it("splits, trims and deduplicates the way better-auth's own reader does", () => {
    expect(legacyMembershipRoleSegments("owner,admin")).toEqual([
      "owner",
      "admin",
    ]);
    expect(legacyMembershipRoleSegments("admin, viewer")).toEqual([
      "admin",
      "viewer",
    ]);
    expect(legacyMembershipRoleSegments("admin,")).toEqual(["admin"]);
    expect(legacyMembershipRoleSegments("admin,admin")).toEqual(["admin"]);
    expect(legacyMembershipRoleSegments(" admin ")).toEqual(["admin"]);
    expect(legacyMembershipRoleSegments(",")).toEqual([]);
  });
});

describe("repairableMembershipRole", () => {
  it("repairs only what can be repaired without choosing anyone's privileges", () => {
    // One distinct role among the pieces: the repair is forced, not chosen.
    expect(repairableMembershipRole("admin,admin")).toBe("admin");
    expect(repairableMembershipRole("admin,")).toBe("admin");
    expect(repairableMembershipRole(" admin ")).toBe("admin");
    expect(repairableMembershipRole("admin, admin")).toBe("admin");
  });

  it("refuses to repair a genuine union — that is an operator's decision, not a migration's", () => {
    expect(repairableMembershipRole("owner,admin")).toBeNull();
    expect(repairableMembershipRole("admin,viewer")).toBeNull();
    expect(repairableMembershipRole("member,owner")).toBeNull();
  });

  it("refuses to repair a value with no role in it at all", () => {
    expect(repairableMembershipRole("")).toBeNull();
    expect(repairableMembershipRole("   ")).toBeNull();
    expect(repairableMembershipRole(",")).toBeNull();
  });

  it("leaves an already-canonical value exactly as it is", () => {
    expect(repairableMembershipRole("owner")).toBe("owner");
  });
});
