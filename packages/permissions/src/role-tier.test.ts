import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  capabilitiesInGroup,
  isCapabilityTier,
  isInstanceCapability,
  tierPermits,
} from "./capabilities";
import { authorityFor, can, expandCapabilities } from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import {
  assertRoleComposition,
  RoleCompositionError,
  roleCompositionProblems,
  roleScopeTier,
} from "./roles";

/**
 * Finding 6 — a workspace role can carry instance authority.
 *
 * `tests/permissions/custom-role.test.ts`'s "cannot mint instance authority through a workspace
 * role" used to assert `true` for exactly the case its name says cannot happen, deferring the
 * real control to "grant time, not evaluation time" — a mechanism this PR did not contain.
 *
 * Two independent boundaries close it: `roleCompositionProblems`/`assertRoleComposition` at
 * grant time (roles.ts), and `expandCapabilities`'s tier clamp at evaluation time
 * (evaluator.ts), wired into `authorityFor` unconditionally so it protects a row no grant-time
 * check ever saw — a migration, a seed script, a plugin fixture, a restored backup, or another
 * service writing `role.capabilities` directly.
 */

const WORKSPACE = "ws-matrix";
const PROJECT = "prj-matrix";
const ORGANISATION = "org-matrix";

function shadowAdminGrant(
  scope: RoleGrant["scope"],
  scopeId: string,
): RoleGrant {
  return {
    roleKey: "shadow-admin",
    scope,
    scopeId,
    rank: 45,
    capabilities: ["instance:admin", "workspace:read"],
  };
}

function identityWith(grant: RoleGrant): ResolvedIdentity {
  return {
    userId: "user-1",
    personId: "person-1",
    side: "staff",
    organisationId: "org-1",
    portal: "agent",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [grant],
  };
}

describe("a workspace-scoped role can never carry instance authority", () => {
  it("N1 — expands an instance:* string in a workspace role row to nothing", () => {
    expect(
      [
        ...expandCapabilities(["instance:admin", "workspace:read"], {
          tier: "workspace",
        }),
      ].sort(),
    ).toEqual(["workspace:read"]);
  });

  it("N2 — mints none of the five instance capabilities through a workspace role", () => {
    const shadow = identityWith(shadowAdminGrant("workspace", WORKSPACE));
    const held = authorityFor(shadow, "workspace", { workspaceId: WORKSPACE });
    expect(held.has("workspace:read")).toBe(true);
    for (const capability of capabilitiesInGroup("Instance")) {
      expect(held.has(capability), capability).toBe(false);
      expect(
        can(shadow, capability, "workspace", { workspaceId: WORKSPACE }),
        capability,
      ).toBe(false);
    }
  });

  it("N3 — refused however the request names the scope", () => {
    const shadow = identityWith(shadowAdminGrant("workspace", WORKSPACE));
    for (const target of [
      { workspaceId: WORKSPACE },
      { instance: true as const, workspaceId: WORKSPACE },
      { instance: true as const, workspaceId: WORKSPACE, projectId: PROJECT },
    ]) {
      expect(
        can(shadow, "instance:admin", "workspace", target),
        JSON.stringify(target),
      ).toBe(false);
      // And naming the policy scope "instance" does not rescue it either — see scope.test.ts's
      // N1 for the containment-table half of this; here the capability itself never expands.
      expect(
        can(shadow, "instance:admin", "instance", target),
        JSON.stringify(target),
      ).toBe(false);
    }
  });

  it("N4 — refused for project- and organisation-scope roles too", () => {
    for (const [scope, scopeId, target] of [
      ["project", PROJECT, { projectId: PROJECT, workspaceId: WORKSPACE }],
      ["organisation", ORGANISATION, { organisationId: ORGANISATION }],
    ] as const) {
      const shadow = identityWith(shadowAdminGrant(scope, scopeId));
      expect(can(shadow, "instance:admin", scope, target), scope).toBe(false);
    }
  });

  it("N5 — reports the refusal rather than dropping it silently", () => {
    const onRefused = vi.fn();
    const shadow = identityWith(shadowAdminGrant("workspace", WORKSPACE));
    authorityFor(
      shadow,
      "workspace",
      { workspaceId: WORKSPACE },
      { onRefused },
    );
    expect(onRefused).toHaveBeenCalledWith("instance:admin", {
      roleKey: "shadow-admin",
      source: "role",
      tier: "workspace",
    });
    expect(
      onRefused.mock.calls.filter((call) => call[0] === "instance:admin"),
    ).toHaveLength(1);
  });

  it("N6 positive control — the instance role still holds instance authority", () => {
    const admin = identityWith({
      roleKey: "instance_admin",
      scope: "instance",
      scopeId: null,
      rank: 1000,
      capabilities: ["instance:admin"],
    });
    for (const capability of capabilitiesInGroup("Instance")) {
      expect(
        can(admin, capability, "workspace", { workspaceId: WORKSPACE }),
        capability,
      ).toBe(true);
    }
  });

  it("grant-time refusal — roleCompositionProblems / assertRoleComposition", () => {
    for (const capability of capabilitiesInGroup("Instance")) {
      for (const scope of ["workspace", "project", "organisation"] as const) {
        expect(
          roleCompositionProblems(scope, [capability]),
          `${scope}/${capability}`,
        ).toHaveLength(1);
      }
    }
    expect(() =>
      assertRoleComposition({
        key: "shadow-admin",
        scope: "workspace",
        capabilities: ["instance:admin"],
      }),
    ).toThrow(RoleCompositionError);
    expect(roleCompositionProblems("instance", ["instance:admin"])).toEqual([]);
    // An unrecognised string is a different concern (onUnknown), not a composition problem.
    expect(
      roleCompositionProblems("workspace", ["instance:not_a_thing"]),
    ).toEqual([]);
  });

  it("instance scope is permitted, and an unknown string is tolerated", () => {
    expect(
      [
        ...expandCapabilities(["instance:admin", "mcp:admin"], {
          tier: "instance",
        }),
      ].sort(),
    ).toContain("instance:admin");
  });

  it("roleScopeTier maps all three non-instance scopes to workspace", () => {
    expect(roleScopeTier("workspace")).toBe("workspace");
    expect(roleScopeTier("project")).toBe("workspace");
    expect(roleScopeTier("organisation")).toBe("workspace");
    expect(roleScopeTier("instance")).toBe("instance");
  });
});

describe("capability tiers", () => {
  it("agrees with the group for every capability", () => {
    for (const name of CAPABILITY_NAMES) {
      const shouldBeInstance = CAPABILITIES[name].group === "Instance";
      expect(isInstanceCapability(name), name).toBe(shouldBeInstance);
    }
  });

  it("tierPermits fails closed on an unrecognised or missing tier", () => {
    expect(tierPermits("god", "workspace:read")).toBe(false);
    expect(tierPermits(undefined, "workspace:read")).toBe(false);
    expect(isCapabilityTier("god")).toBe(false);
    expect(isCapabilityTier(undefined)).toBe(false);
  });

  it("no workspace-tier capability implies an instance-tier one", () => {
    for (const name of CAPABILITY_NAMES) {
      if (isInstanceCapability(name)) continue;
      for (const implied of CAPABILITIES[name].implies) {
        expect(implied, `${name} implies ${implied}`).not.toBe("instance:*");
        expect(
          implied.startsWith("instance:"),
          `${name} implies ${implied}`,
        ).toBe(false);
      }
    }
  });
});
