import { CAPABILITY_NAMES } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  InvalidCapabilityError,
  InvalidPermissionResourceError,
} from "../../../apps/api/src/workspace/controllers/workspace-role-errors";
import {
  capabilitiesBeyond,
  capabilitiesFromLegacyBody,
  closureOfRequested,
  isReservedRoleName,
  previewCapabilitySet,
  roleKeyFromName,
} from "../../../apps/api/src/workspace/role-service";

describe("role key derivation", () => {
  it("makes a lower-case dashed key that can never hold a comma or edge whitespace", () => {
    expect(roleKeyFromName("  Support Lead  ")).toBe("support-lead");
    expect(roleKeyFromName("QA, Triage / Ops")).toBe("qa-triage-ops");
    expect(roleKeyFromName("Équipe Soutien")).toBe("équipe-soutien");
    expect(roleKeyFromName("---")).toBe("");
    expect(roleKeyFromName("!!!")).toBe("");
  });

  it("reserves every built-in key under any normalisation", () => {
    for (const name of [
      "Owner",
      "  MANAGER ",
      "instance_admin",
      "Instance Admin",
      "customer",
    ]) {
      expect(isReservedRoleName(name, roleKeyFromName(name)), name).toBe(true);
    }
    expect(isReservedRoleName("Support Lead", "support-lead")).toBe(false);
  });
});

describe("requested capability sets", () => {
  it("expands implications into the stored closure, sorted", () => {
    expect(closureOfRequested(["work_item:update"])).toEqual([
      "work_item:read",
      "work_item:update",
    ]);
  });

  it("refuses unknown and instance-tier names (RL-6), naming each", () => {
    expect(() => closureOfRequested(["work_item:read", "made:up"])).toThrow(
      InvalidCapabilityError,
    );
    try {
      closureOfRequested(["instance:admin", "made:up"]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as InvalidCapabilityError).capabilities).toEqual([
        "instance:admin",
        "made:up",
      ]);
    }
  });

  it("accepts the whole workspace-tier vocabulary", () => {
    const workspaceTier = CAPABILITY_NAMES.filter(
      (name) => !name.startsWith("instance:"),
    );
    expect(closureOfRequested(workspaceTier).length).toBe(workspaceTier.length);
  });

  it("validates a legacy statement body the way the inherited route did", () => {
    expect(capabilitiesFromLegacyBody({ work_item: ["read"] })).toEqual([
      "work_item:read",
    ]);
    expect(() => capabilitiesFromLegacyBody({ fooo: ["bar"] })).toThrow(
      InvalidPermissionResourceError,
    );
    expect(() => capabilitiesFromLegacyBody({ work_item: ["bogus"] })).toThrow(
      InvalidPermissionResourceError,
    );
  });

  it("lists what the caller does not hold (RL-3), and everything when they hold nothing", () => {
    const held = new Set(["work_item:read"]);
    expect(
      capabilitiesBeyond(["work_item:read", "work_item:update"], held),
    ).toEqual(["work_item:update"]);
    expect(capabilitiesBeyond(["work_item:read"], null)).toEqual([
      "work_item:read",
    ]);
  });
});

describe("role preview (RL-12)", () => {
  it("shows navigation and actions a draft set would allow, without persisting anything", () => {
    const preview = previewCapabilitySet(["work_item:update", "project:read"]);
    const nav = Object.fromEntries(
      preview.navigation.map((entry) => [entry.key, entry.allowed]),
    );
    expect(nav.projects).toBe(true);
    expect(nav.work_items).toBe(true);
    expect(nav.settings_roles).toBe(false);
    const actions = Object.fromEntries(
      preview.workItemActions.map((entry) => [entry.key, entry.allowed]),
    );
    expect(actions.edit).toBe(true);
    expect(actions.delete).toBe(false);
    expect(actions.assign).toBe(false);
  });

  it("refuses an unknown draft capability rather than ignoring it", () => {
    expect(() => previewCapabilitySet(["made:up"])).toThrow(
      InvalidCapabilityError,
    );
  });
});
