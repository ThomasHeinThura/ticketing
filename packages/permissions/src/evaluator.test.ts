import { describe, expect, it, vi } from "vitest";
import {
  authorityFor,
  can,
  evaluatePolicy,
  expandCapabilities,
  type PolicyContext,
  projectScopeFromRow,
  reaches,
  workItemScopeFromRow,
  workspaceScopeFromRow,
} from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import type { Policy } from "./policy";

const WORKSPACE = "ws-1";
const PROJECT = "prj-1";
const WORK_ITEM = "wi-1";

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
      "workspace",
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
      "workspace",
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
      "project",
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
      "workspace",
      { workspaceId: WORKSPACE },
    );
    expect(held.has("instance:manage_plugins")).toBe(true);
  });

  it("clamps to the API key's frozen capability subset", () => {
    const withKey = {
      authority: [grant({ capabilities: ["work_item:update"] })],
      keyCapabilities: ["work_item:read"],
    };
    expect(
      can(withKey, "work_item:read", "workspace", { workspaceId: WORKSPACE }),
    ).toBe(true);
    expect(
      can(withKey, "work_item:update", "workspace", {
        workspaceId: WORKSPACE,
      }),
    ).toBe(false);
  });

  it("M1: an api_key identity with no keyCapabilities holds no capability at all — missing key data must never widen authority", () => {
    // A key row with a null capability column, or a resolver branch that threw and was
    // swallowed: `credential` is unmistakably "api_key", but `keyCapabilities` never arrived.
    // An instance-scope grant so the unrelated tier clamp (finding 6) is not itself what
    // denies this — the ONLY thing standing between this identity and instance:admin is the
    // API-key clamp under test.
    const noKeyData = {
      credential: "api_key" as const,
      authority: [
        grant({
          roleKey: "instance_admin",
          scope: "instance",
          scopeId: null,
          rank: 100,
          capabilities: ["instance:admin"],
        }),
      ],
      // keyCapabilities intentionally omitted — the invariant violation under test.
    };
    expect(can(noKeyData, "instance:admin", "instance", {})).toBe(false);

    // A session identity with no keyCapabilities is the ordinary, invariant-respecting case
    // and must still get its full RBAC — this is not a blanket "no keyCapabilities ⇒ deny".
    const sessionIdentity = {
      credential: "session" as const,
      authority: [
        grant({
          roleKey: "instance_admin",
          scope: "instance",
          scopeId: null,
          rank: 100,
          capabilities: ["instance:admin"],
        }),
      ],
    };
    expect(can(sessionIdentity, "instance:admin", "instance", {})).toBe(true);
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
  // workItemId/workItemProjectId are here so the work_item-scope policies below (comment and
  // work_item:assign) resolve a scope at all — finding 4 made `evaluatePolicy` actually read
  // `policy.scope`, so a work_item-scope policy now needs the target to name a work item, not
  // just a project.
  const target = {
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    workItemId: "wi-1",
    workItemProjectId: PROJECT,
  };

  // `inReach` defaults to `true` here so that every existing capability-kind test below keeps
  // exercising the code past the reach gate, the same way it did when the field was optional
  // and simply omitted. The default is now written down in one place rather than implied by
  // omission at each call site — which is the point of defect 5's fix.
  function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
    return { identity: identity(), target, inReach: true, ...overrides };
  }

  // Finding 4: resolved scope evidence is mandatory, with no fallback to the flat `target` bag
  // above — every capability-kind test below now passes the resolved scope its policy declares
  // (row-sourced, matching `target`'s own ids) rather than relying on the removed fallback.
  const PROJECT_SCOPE = projectScopeFromRow({
    projectId: PROJECT,
    workspaceId: WORKSPACE,
  });
  const WORK_ITEM_SCOPE = workItemScopeFromRow({
    workItemId: WORK_ITEM,
    projectId: PROJECT,
    workspaceId: WORKSPACE,
  });
  const WORKSPACE_SCOPE = workspaceScopeFromRow({ workspaceId: WORKSPACE });

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
      {
        capability: "work_item:read",
        scope: "project",
        scopeSource: "row",
        reach: "required",
      },
      { authenticated: true, self: true, personParam: "personId" },
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
      {
        capability: "work_item:read",
        scope: "project",
        scopeSource: "row",
        reach: "required",
      },
      context({
        identity: identity({
          authority: [grant({ capabilities: ["work_item:read"] })],
        }),
        scope: PROJECT_SCOPE,
      }),
    );
    expect(decision).toEqual({ allowed: true, requiresElevation: false });
  });

  it("kind 1: 403s with the missing capability named", () => {
    const decision = evaluatePolicy(
      {
        capability: "work_item:delete",
        scope: "project",
        scopeSource: "row",
        reach: "required",
      },
      context({
        identity: identity({
          authority: [grant({ capabilities: ["work_item:read"] })],
        }),
        scope: PROJECT_SCOPE,
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
      {
        capability: "work_item:read",
        scope: "project",
        scopeSource: "row",
        reach: "required",
      },
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
      scopeSource: "row",
      reach: "required",
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
          scope: WORK_ITEM_SCOPE,
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
          scope: WORK_ITEM_SCOPE,
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
          scope: WORK_ITEM_SCOPE,
        }),
      ).allowed,
    ).toBe(false);
  });

  it("honours the withinMinutes edit window from the registry", () => {
    const policy: Policy = {
      capability: "comment:update_any",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
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
          scope: WORK_ITEM_SCOPE,
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
          scope: WORK_ITEM_SCOPE,
        }),
      ).allowed,
    ).toBe(false);
  });

  it("orSelfTarget lets a member self-assign, and does not let a viewer", () => {
    const policy: Policy = {
      capability: "work_item:assign",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
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
          scope: WORK_ITEM_SCOPE,
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
          scope: WORK_ITEM_SCOPE,
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
          scope: WORK_ITEM_SCOPE,
        }),
      ).allowed,
    ).toBe(false);
  });

  it("M3: orSelfTarget dispatches on the declared predicate and fails closed on an unrecognised one", () => {
    // Mirrors `ownerPredicateHolds`'s own coverage: a predicate string outside the closed
    // `BODY_PREDICATES` set must never fall back to whichever check happens to be hard-coded
    // — it must deny, the same way `ownerPredicateHolds`'s `default` case does. The identity
    // holds the branch's capability and the body's assigneeId genuinely matches the actor, so
    // the ONLY thing standing between allow and deny is the predicate dispatch itself.
    const policy: Policy = {
      capability: "work_item:delete",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
      orSelfTarget: {
        // A registry entry that never met `validatePolicy` (JSON, a plugin, a corrupted row) —
        // outside the closed BODY_PREDICATES set `validatePolicy` checks membership against.
        predicate: "some.garbage.predicate" as never,
        capability: "work_item:update",
      },
    };
    const decision = evaluatePolicy(
      policy,
      context({
        body: { assigneeId: "person-1" },
        identity: identity({
          authority: [grant({ capabilities: ["work_item:update"] })],
        }),
        scope: WORK_ITEM_SCOPE,
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("L9: a future createdAt does not leave the withinMinutes window permanently open", () => {
    const policy: Policy = {
      capability: "comment:update_any",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
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

    // Clock skew, an importer preserving a source system's original timestamp, or any path
    // that lets a client supply created_at: this row's createdAt is an hour AHEAD of now, so
    // `now - createdAt` is negative — and a negative number is `<=` every positive window
    // bound, which used to read as "inside the window forever".
    expect(
      evaluatePolicy(
        policy,
        context({
          identity: owner,
          now,
          row: {
            personId: "person-1",
            createdAt: new Date("2026-09-06T13:00:00Z"),
          },
          scope: WORK_ITEM_SCOPE,
        }),
      ).allowed,
    ).toBe(false);
  });

  it("kind 2: refuses a parameter naming another person, with a 404", () => {
    const policy: Policy = {
      authenticated: true,
      self: true,
      personParam: "personId",
    };
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
      evaluatePolicy(
        policy,
        context({ identity: customer, portalPredicateSatisfied: true }),
      ).allowed,
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
      scopeSource: "row",
      reach: "required",
      elevated: true,
      sessionOnly: true,
    };
    const holder = (credential: ResolvedIdentity["credential"]) =>
      identity({
        credential,
        authority: [grant({ capabilities: ["webhook:manage"] })],
      });

    expect(
      evaluatePolicy(
        policy,
        context({ identity: holder("session"), scope: WORKSPACE_SCOPE }),
      ),
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

/**
 * Defect 3 — declared `sessionOnly` and `elevated` metadata used to be silently inert on kind
 * 4 (public) and kind 5 (delegated): `evaluatePolicy` returned a successful decision before
 * either flag was ever read, while `sessionOnlyRoutes()` listed the route and
 * `renderElevatedActionsMarkdown()` printed it into rbac.md. Every case here proves the
 * opposite: no kind returns success before its declared flags are enforced, and a flag a kind
 * cannot coherently declare (kind 4 has no identity to re-authenticate or hold a session) is
 * refused rather than ignored.
 */
describe("declared security metadata is never inert", () => {
  const target = { workspaceId: WORKSPACE, projectId: PROJECT };
  const TARGET_PERSON = "person-1";

  /** One identity shape that satisfies every constrainable kind: a customer session holding
   *  project:read, naming itself as the target person. The kind is the only variable. */
  function holder(
    credential: ResolvedIdentity["credential"],
  ): ResolvedIdentity {
    return identity({
      credential,
      side: "customer",
      portal: "customer",
      personId: TARGET_PERSON,
      authority: [grant({ capabilities: ["project:read"] })],
    });
  }

  function ctxFor(who: ResolvedIdentity | null): PolicyContext {
    return {
      identity: who,
      target,
      inReach: true,
      targetPersonId: TARGET_PERSON,
      portalPredicateSatisfied: true,
      // Only the "capability" constrainable policy below reads this — finding 4 made it
      // mandatory for a capability policy, and `evaluatePolicy` never consults it for the
      // other three kinds, so supplying it unconditionally here is harmless for them.
      scope: projectScopeFromRow({
        projectId: PROJECT,
        workspaceId: WORKSPACE,
      }),
    };
  }

  const constrainable: Array<[string, Policy]> = [
    [
      "capability",
      {
        capability: "project:read",
        scope: "project",
        scopeSource: "row",
        reach: "required",
        elevated: true,
        sessionOnly: true,
      },
    ],
    [
      "self",
      {
        authenticated: true,
        self: true,
        personParam: "personId",
        elevated: true,
        sessionOnly: true,
      },
    ],
    [
      "portal",
      {
        portal: "customer",
        predicate: "own_request",
        elevated: true,
        sessionOnly: true,
      },
    ],
    [
      "delegated",
      {
        delegated: "scim",
        reason: "SCIM provisioning surface",
        elevated: true,
        sessionOnly: true,
      },
    ],
  ];

  it.each(constrainable)(
    "refuses every non-session credential on a %s policy",
    (_kind, policy) => {
      for (const credential of [
        "api_key",
        "mcp_key",
        "impersonation",
      ] as const) {
        expect(
          evaluatePolicy(policy, ctxFor(holder(credential))),
        ).toMatchObject({
          allowed: false,
          status: 403,
          code: "session_required",
        });
      }
    },
  );

  it.each(constrainable)(
    "refuses an unauthenticated request on a %s policy",
    (_kind, policy) => {
      expect(evaluatePolicy(policy, ctxFor(null))).toMatchObject({
        allowed: false,
        status: 401,
      });
    },
  );

  it.each(constrainable)(
    "carries elevated: true into the decision on a %s policy",
    (_kind, policy) => {
      const decision = evaluatePolicy(policy, ctxFor(holder("session")));
      expect(decision.allowed).toBe(true);
      if (decision.allowed) expect(decision.requiresElevation).toBe(true);
    },
  );

  it("denies a public policy declaring sessionOnly rather than ignoring it", () => {
    // Cast through unknown: this is the JSON- or plugin-supplied shape the type checker never
    // sees. `validatePolicy` already refused this shape on HEAD, but `evaluatePolicy` — called
    // directly, without the registry, from the matrix fixture and #10's middleware — allowed
    // it on every credential.
    const policy = {
      public: true,
      reason: "liveness probe",
      sessionOnly: true,
    } as unknown as Policy;
    for (const who of [null, holder("session"), holder("mcp_key")]) {
      expect(evaluatePolicy(policy, ctxFor(who))).toMatchObject({
        allowed: false,
        status: 403,
        code: "policy_incoherent",
      });
    }
  });

  it("denies a public policy declaring elevated: true rather than ignoring it", () => {
    // One keystroke away from apps/api/src/instance/policy.ts's shipped shape: flipping its
    // `elevated: false` to `true` produced an allowed decision with requiresElevation: false
    // on HEAD, and no layer objected.
    const policy = {
      public: true,
      reason: "first-run bootstrap",
      elevated: true,
    } as unknown as Policy;
    for (const who of [null, holder("session"), holder("mcp_key")]) {
      expect(evaluatePolicy(policy, ctxFor(who))).toMatchObject({
        allowed: false,
        status: 403,
        code: "policy_incoherent",
      });
    }
  });

  it("still allowlists a delegated mount that declares no flags, on every credential", () => {
    // The regression guard that matters most: /api/auth/* sign-in must stay reachable with no
    // session and no identity at all.
    const policy: Policy = { delegated: "better-auth", reason: "auth mount" };
    for (const credential of [
      "session",
      "api_key",
      "mcp_key",
      "impersonation",
    ] as const) {
      expect(evaluatePolicy(policy, ctxFor(holder(credential)))).toEqual({
        allowed: true,
        requiresElevation: false,
      });
    }
    expect(evaluatePolicy(policy, ctxFor(null))).toEqual({
      allowed: true,
      requiresElevation: false,
    });
  });

  it("leaves a public route's reasoned elevation waiver alone", () => {
    // Guards against the over-correction that would break the shipped registry: dropping
    // `elevated` entirely from kind 4 would make GET /api/instance/status fail
    // elevationViolations() at boot.
    const policy: Policy = {
      public: true,
      reason: "first-run bootstrap",
      elevated: false,
      elevationExemptionReason: "reads one boolean; it grants nothing",
    };
    expect(evaluatePolicy(policy, ctxFor(null))).toEqual({
      allowed: true,
      requiresElevation: false,
    });
  });
});
