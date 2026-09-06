import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  NO_PERSON_PARAMETER,
  NO_SINGLE_RESOURCE,
  type PolicyContext,
} from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import type { Policy } from "./policy";

/**
 * Defect 5 — missing security context used to mean ALLOW. `inReach`, `targetPersonId` and
 * `portalPredicateSatisfied` were each optional and defaulted to permission when omitted, so a
 * middleware that forgot one line — or a `try`/`catch` that left a value unset — compiled and
 * passed.
 *
 * Every case here is written the way a middleware writes it when a line is forgotten: the
 * field is left `undefined`, set to `null`, or set to a value of the wrong shape. On the code
 * this file replaces, each one of them returned `{ allowed: true }`. Here, absence is a
 * denial: `500 policy_context_incomplete`, never a 403 (we do not know the caller lacks
 * authority) and never a 404 (we do not know the row is out of reach).
 */

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
    authority: [grant({ capabilities: ["project:read"] })],
    ...overrides,
  };
}

const target = { workspaceId: WORKSPACE, projectId: PROJECT };
const base = { identity: identity(), target };

function expectContextRefusal(decision: ReturnType<typeof evaluatePolicy>) {
  expect(decision).toMatchObject({
    allowed: false,
    status: 500,
    code: "policy_context_incomplete",
  });
}

const REACH_REQUIRED: Policy = {
  capability: "project:read",
  scope: "project",
  reach: "required",
};

const SELF_WITH_PARAM: Policy = {
  authenticated: true,
  self: true,
  personParam: "personId",
};

const PORTAL: Policy = { portal: "customer", predicate: "own_request" };

describe("missing security context is never allow", () => {
  it("never allows a reach-required route whose reach answer was not supplied", () => {
    expectContextRefusal(
      evaluatePolicy(REACH_REQUIRED, { ...base } as unknown as PolicyContext),
    );
  });

  it("treats a non-boolean reach answer as no answer", () => {
    for (const bad of [null, "true", 1, {}]) {
      expectContextRefusal(
        evaluatePolicy(REACH_REQUIRED, {
          ...base,
          inReach: bad,
        } as unknown as PolicyContext),
      );
    }
  });

  it("refuses a caller that claims the reach exemption the route did not declare", () => {
    expectContextRefusal(
      evaluatePolicy(REACH_REQUIRED, {
        ...base,
        inReach: NO_SINGLE_RESOURCE,
      }),
    );
  });

  it("never allows a self route whose person parameter was not extracted", () => {
    expectContextRefusal(
      evaluatePolicy(SELF_WITH_PARAM, {
        ...base,
      } as unknown as PolicyContext),
    );
  });

  it("never allows a self route whose person parameter was null", () => {
    expectContextRefusal(
      evaluatePolicy(SELF_WITH_PARAM, {
        ...base,
        targetPersonId: null,
      }),
    );
  });

  it("refuses a caller claiming the no_person_parameter exemption a route did not declare", () => {
    expectContextRefusal(
      evaluatePolicy(SELF_WITH_PARAM, {
        ...base,
        targetPersonId: NO_PERSON_PARAMETER,
      }),
    );
  });

  it("never allows a portal route whose predicate was not answered", () => {
    const customer = identity({ side: "customer", portal: "customer" });
    for (const bad of [undefined, null, "yes"]) {
      expectContextRefusal(
        evaluatePolicy(PORTAL, {
          identity: customer,
          target,
          portalPredicateSatisfied: bad,
        } as unknown as PolicyContext),
      );
    }
  });

  it("never allows a capability policy that declares no reach requirement at all", () => {
    // A policy map that never met the registry's validation (a JSON- or plugin-supplied map).
    // Even a genuinely true `inReach` must not rescue a policy that never declared the
    // question exists — guessing "no reach question" here is exactly the omission this fix
    // exists to refuse.
    expectContextRefusal(
      evaluatePolicy(
        { capability: "project:read", scope: "project" } as Policy,
        { ...base, inReach: true },
      ),
    );
  });

  it("never allows a self policy that declares no personParam at all", () => {
    expectContextRefusal(
      evaluatePolicy({ authenticated: true, self: true } as Policy, {
        ...base,
        targetPersonId: "person-1",
      }),
    );
  });

  it("still allows the routes that legitimately have no reach or person to check", () => {
    const reachExempt: Policy = {
      capability: "project:read",
      scope: "project",
      reach: {
        exempt: "no_single_resource",
        reason: "a collection scoped by the query itself",
      },
    };
    expect(
      evaluatePolicy(reachExempt, { ...base, inReach: NO_SINGLE_RESOURCE })
        .allowed,
    ).toBe(true);
    // Omitting the field entirely is equally legitimate once the route declares the exemption.
    expect(
      evaluatePolicy(reachExempt, { ...base } as PolicyContext).allowed,
    ).toBe(true);

    const selfExempt: Policy = {
      authenticated: true,
      self: true,
      personParam: {
        exempt: "no_person_parameter",
        reason: "/api/me/* addresses the session's own person",
      },
    };
    expect(
      evaluatePolicy(selfExempt, {
        ...base,
        targetPersonId: NO_PERSON_PARAMETER,
      }).allowed,
    ).toBe(true);
  });

  it("still answers 401, not 500, for an anonymous caller", () => {
    // Not a proof of the bypass — a preservation test. It exists because the naive placement
    // of the context check (before the identity check) would turn every unauthenticated
    // request into a 500, since a middleware has nothing loaded yet to answer with.
    expect(
      evaluatePolicy(REACH_REQUIRED, {
        ...base,
        identity: null,
      } as unknown as PolicyContext),
    ).toMatchObject({ allowed: false, status: 401 });
  });
});
