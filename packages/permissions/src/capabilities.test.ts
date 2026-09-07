import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_NAMES,
  capabilitiesInGroup,
  isCapability,
} from "./capabilities";

describe("the capability registry", () => {
  it("names every capability as resource:action, singular snake_case", () => {
    for (const name of CAPABILITY_NAMES) {
      expect(name, name).toMatch(/^[a-z][a-z_]*:[a-z][a-z_]*$/);
    }
  });

  it("gives every capability exactly one group, and every group is declared", () => {
    for (const name of CAPABILITY_NAMES) {
      expect(CAPABILITY_GROUPS, name).toContain(CAPABILITIES[name].group);
    }
    for (const group of CAPABILITY_GROUPS) {
      expect(capabilitiesInGroup(group).length, group).toBeGreaterThan(0);
    }
  });

  it("gives every capability a description", () => {
    for (const name of CAPABILITY_NAMES) {
      expect(CAPABILITIES[name].description.trim(), name).not.toBe("");
    }
  });

  it("only implies capabilities that exist, or the one instance wildcard", () => {
    for (const name of CAPABILITY_NAMES) {
      for (const implied of CAPABILITIES[name].implies) {
        if (implied === "instance:*") continue;
        expect(isCapability(implied), `${name} implies ${implied}`).toBe(true);
      }
    }
  });

  it("holds the wildcard implication on instance:admin alone", () => {
    const wildcardHolders = CAPABILITY_NAMES.filter((name) =>
      CAPABILITIES[name].implies.includes("instance:*"),
    );
    expect(wildcardHolders).toEqual(["instance:admin"]);
  });

  it("has no implication cycle", () => {
    const seen = new Set<string>();
    const visit = (name: string, stack: string[]): void => {
      if (stack.includes(name)) {
        throw new Error(`implication cycle: ${[...stack, name].join(" → ")}`);
      }
      if (seen.has(name)) return;
      seen.add(name);
      const definition = CAPABILITIES[name as keyof typeof CAPABILITIES];
      for (const implied of definition.implies) {
        if (implied === "instance:*") continue;
        visit(implied, [...stack, name]);
      }
    };
    for (const name of CAPABILITY_NAMES) visit(name, []);
  });

  it("rejects a string that is not a capability", () => {
    expect(isCapability("work_item:read")).toBe(true);
    expect(isCapability("mcp:admin")).toBe(false);
    expect(isCapability("instance:*")).toBe(false);
    expect(isCapability("toString")).toBe(false);
  });
});
