/**
 * Unit tests for the pure half of the issue #318 (security) audit script -- see that
 * script's own doc comment for why it is report-only rather than a migration.
 */
import { BUILT_IN_ROLE_KEYS } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  type ReservedRoleNameViolationRow,
  reservedRoleNameViolations,
} from "../../../apps/api/scripts/audit-reserved-workspace-role-names";

function row(
  overrides: Partial<ReservedRoleNameViolationRow> = {},
): ReservedRoleNameViolationRow {
  return {
    id: "role-1",
    workspaceId: "ws-1",
    role: "manager",
    isSystem: false,
    ...overrides,
  };
}

describe("reservedRoleNameViolations", () => {
  it("flags a custom row (is_system = false) whose role names a BUILT_IN_ROLES key", () => {
    const violations = reservedRoleNameViolations([
      row({ role: "manager", isSystem: false }),
    ]);
    expect(violations).toEqual([
      { id: "role-1", workspaceId: "ws-1", role: "manager" },
    ]);
  });

  it("does not flag a genuine seeded row (is_system = true) with the same name", () => {
    expect(
      reservedRoleNameViolations([row({ role: "admin", isSystem: true })]),
    ).toEqual([]);
  });

  it("does not flag an ordinary custom role whose name is not a BUILT_IN_ROLES key", () => {
    expect(
      reservedRoleNameViolations([
        row({ role: "acme-support-triage", isSystem: false }),
      ]),
    ).toEqual([]);
  });

  it("flags every BUILT_IN_ROLES key, including 'owner' -- a workspace_role row named 'owner' is itself a data anomaly this check correctly surfaces (it never gets a row through any known write path)", () => {
    for (const key of BUILT_IN_ROLE_KEYS) {
      const violations = reservedRoleNameViolations([
        row({ id: `role-${key}`, role: key, isSystem: false }),
      ]);
      expect(violations, key).toEqual([
        { id: `role-${key}`, workspaceId: "ws-1", role: key },
      ]);
    }
  });

  it("reports one violation per offending row, across workspaces, in the order given", () => {
    const violations = reservedRoleNameViolations([
      row({ id: "a", workspaceId: "ws-1", role: "manager", isSystem: false }),
      row({ id: "b", workspaceId: "ws-2", role: "lead", isSystem: false }),
      row({ id: "c", workspaceId: "ws-1", role: "custom", isSystem: false }),
      row({ id: "d", workspaceId: "ws-2", role: "admin", isSystem: true }),
    ]);
    expect(violations).toEqual([
      { id: "a", workspaceId: "ws-1", role: "manager" },
      { id: "b", workspaceId: "ws-2", role: "lead" },
    ]);
  });

  it("returns an empty report for an empty table", () => {
    expect(reservedRoleNameViolations([])).toEqual([]);
  });

  // Mutation-check: each of these probes a specific boundary the implementation must get
  // exactly right, not just "roughly right" -- a mutant that flips `!row.isSystem` to
  // `row.isSystem`, or that used `includes` instead of an exact `Set` membership test
  // (matching a substring or a differently-cased name), would fail one of these.
  describe("mutation-check boundaries", () => {
    it("is case-sensitive -- 'Manager' is not a BUILT_IN_ROLES key and is not flagged", () => {
      expect(
        reservedRoleNameViolations([row({ role: "Manager", isSystem: false })]),
      ).toEqual([]);
    });

    it("does not match on a substring -- 'managerial' is not flagged", () => {
      expect(
        reservedRoleNameViolations([
          row({ role: "managerial", isSystem: false }),
        ]),
      ).toEqual([]);
    });

    it("isSystem must be exactly true to clear a row -- a truthy non-boolean is still flagged", () => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input, proving the check does not coerce.
      const malformedRow = row({ role: "manager", isSystem: 1 as any });
      const violations = reservedRoleNameViolations([malformedRow]);
      expect(violations).toEqual([
        { id: "role-1", workspaceId: "ws-1", role: "manager" },
      ]);
    });
  });
});
