import { describe, expect, it, vi } from "vitest";
import {
  authorityFor,
  can,
  evaluatePolicy,
  expandCapabilities,
  type PolicyContext,
  reaches,
} from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import type { Policy } from "./policy";

const WORKSPACE = "ws-1";
const PROJECT = "prj-1";

function grant(overrides: Partial<RoleGrant> = {}): RoleGrant {
  return {
    roleKey: "member",
    scope: "workspace",
    scopeId: WORKSPACE,
    rank: 40,
    capabilities: [],
    ...overrides,
  };
}

function identity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    userId: "user-1",
    personId: "person-1",
    side: "staff",
    organisationId: "org-1",
    portal: "agent",
    credential: "session",
    memberships: [{ scope: "project", scopeId: PROJECT, seesAll: false }],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [],
    ...overrides,
  };
}

describe("expandCapabilities", () => {
  it("expands implications transitively", () => {
    // comment:delete_any → comment:delete_own → comment:create → work_item:read
    expect([...expandCapabilities(["comment:delete_any"])].sort()).toEqual([
      "comment:create",
      "comment:delete_any",
      "comment:delete_own",
      "work_item:read",
    ]);
  });

  it("expands the instance wildcard to every instance capability", () => {
    const expanded = expandCapabilities(["instance:admin"]);
    expect(expanded.has("instance:read_audit")).toBe(true);
    expect(expanded.has("instance:manage_plugins")).toBe(true);
    expect(expanded.has("instance:manage_jobs")).toBe(true);
    expect(expanded.has("instance:manage_terminology")).toBe(true);
    // The wildcard is instance:* — it never leaks into another group.
    expect(expanded.has("workspace:read")).toBe(false);
  });

  it("logs an unrecognised capability and treats it as absent", () => {
    const onUnknown = vi.fn();
    const expanded = expandCapabilities(["work_item:read", "mcp:admin"], {
      onUnknown,
      roleKey: "custom-role",
    });
    expect([...expanded]).toEqual(["work_item:read"]);
    expect(onUnknown).toHaveBeenCalledWith("mcp:admin", {
      roleKey: "custom-role",
      source: "role",
    });
  });

  it("never wildcard-expands an unrecognised capability", () => {
    expect([...expandCapabilities(["instance:*"])]).toEqual([]);
    expect([...expandCapabilities(["work_item:*"])]).toEqual([]);
  });
});

describe("authority", () => {
  it("unions the capabilities of every role that applies to the scope", () => {
    const held = authorityFor(
      {
        authority: [
          grant({ capabilities: ["work_item:create"] }),
          grant({ roleKey: "extra", capabilities: ["work_item:export"] }),
        ],
      },
      { workspaceId: WORKSPACE },
    );
    expect(held.has("work_item:create")).toBe(true);
    expect(held.has("work_item:export")).toBe(true);
    expect(held.has("work_item:read")).toBe(true); // implied by both
  });

  it("ignores a role attached to another workspace", () => {
    const held = authorityFor(
      {
        authority: [
          grant({ scopeId: "ws-other", capabilities: ["project:delete"] }),
        ],
      },
      { workspaceId: WORKSPACE },
    );
    expect(held.size).toBe(0);
  });

  it("lets a project role override the workspace role for that project", () => {
    const held = authorityFor(
      {
        authority: [
          grant({ capabilities: ["work_item:delete"] }),
          grant({
            roleKey: "project-viewer",
            scope: "project",
            scopeId: PROJECT,
            capabilities: ["work_item:read"],
          }),
        ],
      },
      { workspaceId: WORKSPACE, projectId: PROJECT },
    );
    expect(held.has("work_item:read")).toBe(true);
    expect(held.has("work_item:delete")).toBe(false);
  });

  it("keeps instance roles applying everywhere", () => {
    const held = authorityFor(
      {
        authority: [
          grant({
            roleKey: "instance_admin",
            scope: "instance",
            scopeId: null,
            capabilities: ["instance:admin"],
          }),
        ],
      },
      { workspaceId: WORKSPACE },
    );
    expect(held.has("instance:manage_plugins")).toBe(true);
  });

  it("clamps to the API key's frozen capability subset", () => {
    const withKey = {
      authority: [grant({ capabilities: ["work_item:update"] })],
      keyCapabilities: ["work_item:read"],
    };
    expect(can(withKey, "work_item:read", { workspaceId: WORKSPACE })).toBe(
      true,
    );
    expect(can(withKey, "work_item:update", { workspaceId: WORKSPACE })).toBe(
      false,
    );
  });
});

describe("reach", () => {
  const project = {
    projectId: PROJECT,
    workspaceId: WORKSPACE,
    organisationId: "org-customer",
  };

  it("1–2: sees everything when reach is all", () => {
    expect(
      reaches(identity({ reach: { kind: "all" }, memberships: [] }), project),
    ).toBe(true);
  });

  it("3: project membership", () => {
    expect(reaches(identity(), project)).toBe(true);
  });

  it("4: membership of an ancestor project", () => {
    const person = identity({
      memberships: [
        { scope: "project", scopeId: "prj-parent", seesAll: false },
      ],
    });
    expect(reaches(person, project)).toBe(false);
    expect(
      reaches(person, { ...project, ancestorProjectIds: ["prj-parent"] }),
    ).toBe(true);
  });

  it("5: a team that owns the project", () => {
    const person = identity({ memberships: [], teamIds: ["team-1"] });
    expect(reaches(person, { ...project, ownerTeamId: "team-1" })).toBe(true);
    expect(reaches(person, { ...project, ownerTeamId: "team-2" })).toBe(false);
  });

  it("6: a customer sees their own organisation and no other", () => {
    const customer = identity({
      side: "customer",
      portal: "customer",
      memberships: [],
      reach: { kind: "organisation", ids: ["org-customer"] },
    });
    expect(reaches(customer, project)).toBe(true);
    expect(reaches(customer, { ...project, organisationId: "org-other" })).toBe(
      false,
    );
    // An internal project belongs to no customer organisation.
    expect(reaches(customer, { ...project, organisationId: null })).toBe(false);
  });

  it("7: otherwise no", () => {
    expect(reaches(identity({ memberships: [] }), project)).toBe(false);
  });

  it("keeps a private record out of a colleague's reach inside the right organisation", () => {
    const customer = identity({
      personId: "colleague",
      side: "customer",
      portal: "customer",
      memberships: [],
      reach: { kind: "organisation", ids: ["org-customer"] },
    });
    expect(
      reaches(customer, { ...project, visibleToPersonIds: ["requester"] }),
    ).toBe(false);
  });

  it("never consults authority — sees_all grants reach, roles do not", () => {
    const seesAll = identity({
      memberships: [],
      reach: { kind: "all" },
      authority: [],
    });
    expect(reaches(seesAll, project)).toBe(true);
    // …and holding every capability grants no reach of its own.
    const powerful = identity({
      memberships: [],
      authority: [grant({ capabilities: ["project:delete"] })],
    });
    expect(reaches(powerful, project)).toBe(false);
  });
});

describe("evaluatePolicy", () => {
  const target = { workspaceId: WORKSPACE, projectId: PROJECT };

  function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
    return { identity: identity(), target, ...overrides };
  }

  it("kind 4: a public route allows an anonymous caller", () => {
    const policy: Policy = { public: true, reason: "login page branding" };
    expect(evaluatePolicy(policy, context({ identity: null }))).toEqual({
      allowed: true,
      requiresElevation: false,
    });
  });

  it("kind 5: a delegated mount is allowlisted, not evaluated", () => {
    const policy: Policy = { delegated: "better-auth", reason: "auth mount" };
    expect(evaluatePolicy(policy, context({ identity: null })).allowed).toBe(
      true,
    );
  });

  it("401s an anonymous caller on every other kind", () => {
    const policies: Policy[] = [
      { capability: "work_item:read", scope: "project" },
      { authenticated: true, self: true },
      { portal: "customer", predicate: "own_request" },
    ];
    for (const policy of policies) {
      const decision = evaluatePolicy(policy, context({ identity: null }));
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.status).toBe(401);
    }
  });

  it("kind 1: allows when the capability is held", () => {
    const decision = evaluatePolicy(
      { capability: "work_item:read", scope: "project" },
      context({
        identity: identity({
          authority: [grant({ capabilities: ["work_item:read"] })],
        }),
      }),
    );
    expect(decision).toEqual({ allowed: true, requiresElevation: false });
  });

  it("kind 1: 403s with the missing capability named", () => {
    const decision = evaluatePolicy(
      { capability: "work_item:delete", scope: "project" },
      context({
        identity: identity({
          authority: [grant({ capabilities: ["work_item:read"] })],
        }),
      }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      status: 403,
      missingCapability: "work_item:delete",
    });
  });

  it("kind 1: 404s out of reach, before any capability is considered", () => {
    const decision = evaluatePolicy(
      { capability: "work_item:read", scope: "project" },
      context({
        inReach: false,
        identity: identity({
          authority: [grant({ capabilities: ["work_item:read"] })],
        }),
      }),
    );
    expect(decision).toMatchObject({ allowed: false, status: 404 });
  });

  it("orOwner is a conjunction, not a bypass", () => {
    const policy: Policy = {
      capability: "comment:update_any",
      scope: "work_item",
      orOwner: {
        predicate: "row.person_id === identity.personId",
        capability: "comment:update_own",
      },
    };
    const own = { personId: "person-1" };

    // Holds comment:update_own and owns the row → allowed.
    expect(
      evaluatePolicy(
        policy,
        context({
          row: own,
          identity: identity({
            authority: [grant({ capabilities: ["comment:update_own"] })],
          }),
        }),
      ).allowed,
    ).toBe(true);

    // Owns the row but the *_own capability was revoked → refused. This is the difference
    // between a conjunction and a bypass.
    expect(
      evaluatePolicy(
        policy,
        context({
          row: own,
          identity: identity({
            authority: [grant({ capabilities: ["work_item:read"] })],
          }),
        }),
      ).allowed,
    ).toBe(false);

    // Holds the *_own capability but does not own the row → refused.
    expect(
      evaluatePolicy(
        policy,
        context({
          row: { personId: "someone-else" },
          identity: identity({
            authority: [grant({ capabilities: ["comment:update_own"] })],
          }),
        }),
      ).allowed,
    ).toBe(false);
  });

  it("honours the withinMinutes edit window from the registry", () => {
    const policy: Policy = {
      capability: "comment:update_any",
      scope: "work_item",
      orOwner: {
        predicate: "row.person_id === identity.personId",
        capability: "comment:update_own",
        withinMinutes: 15,
      },
    };
    const owner = identity({
      authority: [grant({ capabilities: ["comment:update_own"] })],
    });
    const now = new Date("2026-09-06T12:00:00Z");

    expect(
      evaluatePolicy(
        policy,
        context({
          identity: owner,
          now,
          row: {
            personId: "person-1",
            createdAt: new Date("2026-09-06T11:50:00Z"),
          },
        }),
      ).allowed,
    ).toBe(true);

    expect(
      evaluatePolicy(
        policy,
        context({
          identity: owner,
          now,
          row: {
            personId: "person-1",
            createdAt: new Date("2026-09-06T11:40:00Z"),
          },
        }),
      ).allowed,
    ).toBe(false);
  });

  it("orSelfTarget lets a member self-assign, and does not let a viewer", () => {
    const policy: Policy = {
      capability: "work_item:assign",
      scope: "work_item",
      orSelfTarget: {
        predicate: "body.assigneeId === identity.personId",
        capability: "work_item:update",
      },
    };
    const body = { assigneeId: "person-1" };

    expect(
      evaluatePolicy(
        policy,
        context({
          body,
          identity: identity({
            authority: [grant({ capabilities: ["work_item:update"] })],
          }),
        }),
      ).allowed,
    ).toBe(true);

    expect(
      evaluatePolicy(
        policy,
        context({
          body,
          identity: identity({
            authority: [grant({ capabilities: ["work_item:read"] })],
          }),
        }),
      ).allowed,
    ).toBe(false);

    // Assigning someone else still needs work_item:assign.
    expect(
      evaluatePolicy(
        policy,
        context({
          body: { assigneeId: "person-2" },
          identity: identity({
            authority: [grant({ capabilities: ["work_item:update"] })],
          }),
        }),
      ).allowed,
    ).toBe(false);
  });

  it("kind 2: refuses a parameter naming another person, with a 404", () => {
    const policy: Policy = { authenticated: true, self: true };
    expect(
      evaluatePolicy(policy, context({ targetPersonId: "person-1" })).allowed,
    ).toBe(true);
    expect(
      evaluatePolicy(policy, context({ targetPersonId: "person-2" })),
    ).toMatchObject({ allowed: false, status: 404 });
  });

  it("kind 3: requires a customer portal session", () => {
    const policy: Policy = { portal: "customer", predicate: "own_request" };
    const customer = identity({ side: "customer", portal: "customer" });
    expect(
      evaluatePolicy(policy, context({ identity: customer })).allowed,
    ).toBe(true);
    expect(evaluatePolicy(policy, context()).allowed).toBe(false);
    expect(
      evaluatePolicy(
        policy,
        context({ identity: customer, portalPredicateSatisfied: false }),
      ),
    ).toMatchObject({ allowed: false, status: 404 });
  });

  it("refuses a session-only route on an API key before the policy runs", () => {
    const policy: Policy = {
      capability: "webhook:manage",
      scope: "workspace",
      elevated: true,
      sessionOnly: true,
    };
    const holder = (credential: ResolvedIdentity["credential"]) =>
      identity({
        credential,
        authority: [grant({ capabilities: ["webhook:manage"] })],
      });

    expect(
      evaluatePolicy(policy, context({ identity: holder("session") })),
    ).toEqual({ allowed: true, requiresElevation: true });

    for (const credential of ["api_key", "mcp_key", "impersonation"] as const) {
      expect(
        evaluatePolicy(policy, context({ identity: holder(credential) })),
      ).toMatchObject({
        allowed: false,
        status: 403,
        code: "session_required",
      });
    }
  });

  it("throws rather than guessing when a policy is not one of the five kinds", () => {
    expect(() =>
      evaluatePolicy({ scope: "project" } as unknown as Policy, context()),
    ).toThrow(/none of the five kinds/);
  });
});
