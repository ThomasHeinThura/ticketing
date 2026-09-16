import { describe, expect, it } from "vitest";
import { roleIsReferencedBy } from "../../../apps/api/src/workspace/controllers/delete-workspace-role";

/**
 * `roleIsReferencedBy` is S7's one deliberate, narrow exception to issue #82's "never
 * comma-split" rule (the delete-guard's "is this role still assigned to anyone" check —
 * Thomas's decision, S7 blueprint Ambiguity Q2). It is unit-tested rather than exercised
 * against a real database because `workspace_member_role_single_value` (migration `0050`)
 * refuses a comma-joined `workspace_member.role` value at the database level for every write,
 * including a raw SQL one — see `delete-workspace-role.ts`'s own doc comment.
 */
describe("roleIsReferencedBy", () => {
  it("matches an exact single-role value", () => {
    expect(roleIsReferencedBy(["custom"], "custom")).toBe(true);
    expect(roleIsReferencedBy(["viewer"], "custom")).toBe(false);
  });

  it("is case-insensitive and trims, matching the normalization create/update apply", () => {
    expect(roleIsReferencedBy([" Custom "], "custom")).toBe(true);
    expect(roleIsReferencedBy(["CUSTOM"], "custom")).toBe(true);
  });

  it("is comma-aware: a comma-joined value referencing the target role is caught", () => {
    expect(roleIsReferencedBy(["custom,admin"], "custom")).toBe(true);
    expect(roleIsReferencedBy(["owner,admin"], "admin")).toBe(true);
    expect(roleIsReferencedBy(["admin, custom"], "custom")).toBe(true);
  });

  it("an exact-match-only reader would have wrongly ALLOWED these -- the case this guard exists for", () => {
    // If the guard compared `value === roleName` instead of splitting, "custom,admin" would
    // not equal "custom" and the delete would proceed even though the role is still held.
    const values = ["custom,admin"];
    expect(values.includes("custom")).toBe(false); // the naive, wrong check
    expect(roleIsReferencedBy(values, "custom")).toBe(true); // the actual guard
  });

  it("does not match when no piece names the role", () => {
    expect(roleIsReferencedBy(["admin,viewer"], "custom")).toBe(false);
    expect(roleIsReferencedBy([], "custom")).toBe(false);
  });

  it("checks every member row, not just the first", () => {
    expect(roleIsReferencedBy(["viewer", "member,custom"], "custom")).toBe(
      true,
    );
  });
});
