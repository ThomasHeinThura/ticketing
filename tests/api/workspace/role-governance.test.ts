import { describe, expect, it } from "vitest";
import {
  capabilitiesGrantRoleManagement,
  diffCapabilities,
  hasActiveRoleManager,
  sortedCapabilities,
} from "../../../apps/api/src/workspace/role-governance";

describe("role audit diff (RL-10)", () => {
  it("lists capability names sorted and de-duplicated", () => {
    expect(
      sortedCapabilities([
        "work_item:update",
        "work_item:read",
        "work_item:read",
      ]),
    ).toEqual(["work_item:read", "work_item:update"]);
    expect(sortedCapabilities(null)).toEqual([]);
  });

  it("records what a save added and removed", () => {
    expect(
      diffCapabilities(
        ["work_item:read", "work_item:update", "label:manage"],
        ["work_item:read", "work_item:delete", "project:read"],
      ),
    ).toEqual({
      added: ["project:read", "work_item:delete"],
      removed: ["label:manage", "work_item:update"],
    });
  });

  it("reports nothing for an unchanged set", () => {
    expect(diffCapabilities(["a:x"], ["a:x"])).toEqual({
      added: [],
      removed: [],
    });
  });

  it("treats a brand-new role as all additions", () => {
    expect(diffCapabilities(null, ["work_item:read"])).toEqual({
      added: ["work_item:read"],
      removed: [],
    });
  });
});

describe("last active role manager (RL-7)", () => {
  const manager = ["workspace:manage_roles"];
  const roles = (entries: Record<string, readonly string[] | null>) =>
    new Map(Object.entries(entries));

  it("recognises the role-management capability, including by implication", () => {
    expect(capabilitiesGrantRoleManagement(manager)).toBe(true);
    expect(capabilitiesGrantRoleManagement(["workspace:read"])).toBe(false);
    expect(capabilitiesGrantRoleManagement(null)).toBe(false);
    // Unknown names grant nothing and never throw.
    expect(capabilitiesGrantRoleManagement(["made:up"])).toBe(false);
  });

  it("is satisfied by an active owner regardless of role rows", () => {
    expect(
      hasActiveRoleManager([{ role: "owner", active: true }], roles({})),
    ).toBe(true);
  });

  it("is satisfied by an active holder of a role granting it", () => {
    expect(
      hasActiveRoleManager(
        [{ role: "ops", active: true }],
        roles({ ops: manager }),
      ),
    ).toBe(true);
  });

  it("fails when the only granting role loses the capability", () => {
    expect(
      hasActiveRoleManager(
        [{ role: "ops", active: true }],
        roles({ ops: ["workspace:read"] }),
      ),
    ).toBe(false);
  });

  it("fails when the only holders are suspended or deactivated", () => {
    expect(
      hasActiveRoleManager(
        [
          { role: "owner", active: false },
          { role: "ops", active: false },
          { role: "member", active: true },
        ],
        roles({ ops: manager, member: ["work_item:read"] }),
      ),
    ).toBe(false);
  });

  it("fails closed for a deleted or malformed role", () => {
    expect(
      hasActiveRoleManager([{ role: "ops", active: true }], roles({})),
    ).toBe(false);
    expect(
      hasActiveRoleManager(
        [{ role: "ops", active: true }],
        roles({ ops: null }),
      ),
    ).toBe(false);
  });
});
