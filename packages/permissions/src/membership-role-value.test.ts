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
  it("repairs a comma-bearing value only when every raw piece is ALREADY the exact same well-formed byte string", () => {
    // Every surviving raw piece is already clean "admin" -- no trimming performed to reach
    // agreement, only to confirm a piece that already agrees is not itself malformed.
    expect(repairableMembershipRole("admin,admin")).toBe("admin");
    expect(repairableMembershipRole("admin,")).toBe("admin");
    expect(repairableMembershipRole(",admin")).toBe("admin");
    expect(repairableMembershipRole("admin,,admin")).toBe("admin");
  });

  it("REGRESSION (formal review R1) -- never trims a value with no comma into a role it does not currently name, because that manufactures authority the row does not hold today", () => {
    // The exact defect: the ORIGINAL version of this function collapsed " owner" to "owner"
    // the same way it collapsed "admin,admin" to "admin". Traced against the real installed
    // better-auth: " owner".split(",") = [" owner"], and neither `isCreator`
    // (.includes("owner")) nor any acRoles[" owner"] lookup matches the padded string -- so
    // TODAY this row grants NOTHING under the plugin evaluator, and the native evaluator
    // denies it too (exact match, no row named " owner"). Trimming it to "owner" would not
    // restate an existing agreement -- "owner" is the one role whose authority is
    // compiled-in and unbounded, so this would MINT full ownership out of a currently
    // privilege-less row, silently, during a security migration. Must refuse.
    expect(repairableMembershipRole(" owner")).toBeNull();
    expect(repairableMembershipRole("owner ")).toBeNull();
    expect(repairableMembershipRole(" owner ")).toBeNull();
    expect(repairableMembershipRole("\towner")).toBeNull();
    // Not owner-specific -- any no-comma padded value must refuse the same way, because the
    // underlying reasoning (no second piece to confirm agreement against) does not depend on
    // which role name is involved.
    expect(repairableMembershipRole(" admin")).toBeNull();
    expect(repairableMembershipRole("admin ")).toBeNull();
    expect(repairableMembershipRole(" admin ")).toBeNull();
  });

  it("REGRESSION (formal review R1) -- refuses a comma-bearing value whose pieces are not byte-identical, even when they would agree after trimming", () => {
    // "admin, admin" used to repair to "admin" under the old rule (both pieces trim to
    // "admin"). That is now refused: the raw pieces "admin" and " admin" are not the exact
    // same byte string, so this is treated the same as genuine ambiguity, not silently
    // resolved by trimming one side into agreement with the other.
    expect(repairableMembershipRole("admin, admin")).toBeNull();
    expect(repairableMembershipRole(" admin,admin")).toBeNull();
    expect(repairableMembershipRole("admin ,admin")).toBeNull();
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
    expect(repairableMembershipRole(",,")).toBeNull();
  });

  it("leaves an already-canonical value exactly as it is", () => {
    expect(repairableMembershipRole("owner")).toBe("owner");
    expect(repairableMembershipRole("admin")).toBe("admin");
  });
});
