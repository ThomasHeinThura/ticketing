import { describe, expect, it } from "vitest";
import { isCapability } from "./capabilities";
import { expandCapabilities } from "./evaluator";
import {
  BUILT_IN_ROLE_KEYS,
  BUILT_IN_ROLES,
  INHERITED_ROLE_KEYS,
} from "./roles";

describe("the built-in roles", () => {
  it("keeps kaneo's four role names, for data continuity", () => {
    for (const key of INHERITED_ROLE_KEYS) {
      expect(BUILT_IN_ROLE_KEYS, key).toContain(key);
    }
  });

  it("names only capabilities that exist", () => {
    for (const key of BUILT_IN_ROLE_KEYS) {
      for (const capability of BUILT_IN_ROLES[key].capabilities) {
        expect(isCapability(capability), `${key}: ${capability}`).toBe(true);
      }
    }
  });

  it("gives owner every capability except instance:*", () => {
    const owner = expandCapabilities(BUILT_IN_ROLES.owner.capabilities);
    expect(owner.has("workspace:delete")).toBe(true);
    expect(owner.has("instance:admin")).toBe(false);
    expect(owner.has("instance:read_audit")).toBe(false);
  });

  it("gives admin exactly owner minus workspace:delete", () => {
    const owner = new Set<string>(BUILT_IN_ROLES.owner.capabilities);
    const admin = new Set<string>(BUILT_IN_ROLES.admin.capabilities);
    expect(admin.has("workspace:delete")).toBe(false);
    owner.delete("workspace:delete");
    expect([...admin].sort()).toEqual([...owner].sort());
  });

  it("keeps the customer role off the ladder — and nothing else, ever", () => {
    const customer = expandCapabilities(BUILT_IN_ROLES.customer.capabilities);
    // A customer may never comment internally, assign, or read a report.
    expect(customer.has("comment:create_internal")).toBe(false);
    expect(customer.has("work_item:assign")).toBe(false);
    expect(customer.has("report:read")).toBe(false);
    // Escalating priority is theirs; setting it up or down is not.
    expect(customer.has("work_item:escalate_priority")).toBe(true);
    expect(customer.has("work_item:set_priority")).toBe(false);
    expect(BUILT_IN_ROLES.customer.scope).toBe("organisation");
  });

  it("keeps viewer read-only", () => {
    const viewer = expandCapabilities(BUILT_IN_ROLES.viewer.capabilities);
    for (const capability of viewer) {
      expect(capability, capability).toMatch(/:(read|read_all)$/);
    }
  });

  it("ranks the workspace ladder in one order, with owner at the top", () => {
    const ladder = [
      "owner",
      "admin",
      "manager",
      "lead",
      "member",
      "viewer",
    ] as const;
    const ranks = ladder.map((key) => BUILT_IN_ROLES[key].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("gives no workspace role an instance capability, ever", () => {
    for (const key of BUILT_IN_ROLE_KEYS) {
      if (BUILT_IN_ROLES[key].scope === "instance") continue;
      const held = expandCapabilities(BUILT_IN_ROLES[key].capabilities);
      for (const capability of held) {
        expect(
          capability.startsWith("instance:"),
          `${key}: ${capability}`,
        ).toBe(false);
      }
    }
  });

  it("makes the instance role hold every instance capability and nothing else", () => {
    const held = expandCapabilities(BUILT_IN_ROLES.instance_admin.capabilities);
    expect([...held].sort()).toEqual([
      "instance:admin",
      "instance:manage_jobs",
      "instance:manage_plugins",
      "instance:manage_terminology",
      "instance:read_audit",
    ]);
  });

  it("keeps owner uneditable", () => {
    expect(BUILT_IN_ROLES.owner.isEditable).toBe(false);
    expect(BUILT_IN_ROLES.admin.isEditable).toBe(true);
  });
});
