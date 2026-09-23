/**
 * Unit tests for issue #8 Slice 2's pure shadow-mode comparison logic
 * (`apps/api/src/permissions/shadow-evaluation.ts`). No database, no Hono `Context` — every
 * branch is reachable with a plain object.
 *
 * Covers: every one of the addendum's five outcome categories, the "unevaluated" reasons
 * `buildShadowPolicySide` can produce (no policy, missing identity, missing row scope, self/
 * portal context unavailable), and the instance-admin bypass surfacing as
 * `legacy_allow_policy_deny` (issue #8's own required example).
 */
import type { RegistryEntry, ResolvedIdentity } from "@taskdesk/permissions";
import {
  BUILT_IN_ROLES,
  evaluatePolicy,
  NO_PERSON_PARAMETER,
  NO_SINGLE_RESOURCE,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  buildShadowPolicySide,
  compareShadowOutcome,
  type LegacyOutcome,
} from "../../../apps/api/src/permissions/shadow-evaluation";
import { normaliseTraceId } from "../../../apps/api/src/permissions/shadow-middleware";

const CAPABILITY_ENTRY: RegistryEntry = {
  routeKey: "GET /api/work-items/{key}",
  kind: "capability",
  source: "apps/api/src/work-item/policy.ts",
  policy: {
    capability: "work_item:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
};

const PUBLIC_ENTRY: RegistryEntry = {
  routeKey: "GET /api/health",
  kind: "public",
  source: "apps/api/src/policy-registry.ts (platform)",
  policy: { public: true, reason: "liveness probe" },
};

const DELEGATED_ENTRY: RegistryEntry = {
  routeKey: "GET /api/ws/user",
  kind: "delegated",
  source: "apps/api/src/policy-registry.ts (websocket)",
  policy: {
    delegated: "websocket",
    reason: "websocket upgrade is authenticated by its handler",
  },
};

const SELF_ENTRY: RegistryEntry = {
  routeKey: "GET /api/user/{id}",
  kind: "self",
  source: "apps/api/src/user/policy.ts",
  policy: { authenticated: true, self: true, personParam: "id" },
};

const SELF_EXEMPT_ENTRY: RegistryEntry = {
  ...SELF_ENTRY,
  policy: {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason: "caller is the target",
    },
  },
};

const PORTAL_ENTRY: RegistryEntry = {
  routeKey: "GET /api/portal/work-items",
  kind: "portal",
  source: "apps/api/src/work-item/policy.ts",
  policy: { portal: "customer", predicate: "own_request" },
};

function identity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    userId: "user_1",
    personId: "person_1",
    side: "staff",
    organisationId: "org_1",
    portal: "agent",
    credential: "session",
    memberships: [{ scope: "workspace", scopeId: "ws_1", seesAll: false }],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [
      {
        roleKey: BUILT_IN_ROLES.member.key,
        scope: BUILT_IN_ROLES.member.scope,
        scopeId: "ws_1",
        rank: BUILT_IN_ROLES.member.rank,
        capabilities: BUILT_IN_ROLES.member.capabilities,
      },
    ],
    keyCapabilities: undefined,
    ...overrides,
  };
}

const ALLOWED: LegacyOutcome = { known: true, allowed: true, status: 200 };
const DENIED_403: LegacyOutcome = { known: true, allowed: false, status: 403 };
const DENIED_400: LegacyOutcome = { known: true, allowed: false, status: 400 };
const DENIED_404: LegacyOutcome = { known: true, allowed: false, status: 404 };
const UNKNOWN: LegacyOutcome = { known: false };

describe("buildShadowPolicySide", () => {
  it("no_policy_registered when the registry has no entry for this route", () => {
    const result = buildShadowPolicySide({
      entry: undefined,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
    });
    expect(result).toBe("no_policy_registered");
  });

  it("evaluates a public policy with no identity at all", () => {
    const result = buildShadowPolicySide({
      entry: PUBLIC_ENTRY,
      identity: null,
      workspaceId: null,
      workspaceIdSource: null,
    });
    expect(result).not.toBe("no_policy_registered");
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.identity).toBeNull();
  });

  it("resolves an explicitly exempt self target to the authenticated person's id", () => {
    const result = buildShadowPolicySide({
      entry: SELF_EXEMPT_ENTRY,
      identity: identity(),
      workspaceId: null,
      workspaceIdSource: null,
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.targetPersonId).toBe(NO_PERSON_PARAMETER);
    expect(evaluatePolicy(result.entry.policy, result.context)).toEqual(
      expect.objectContaining({ allowed: true }),
    );
  });

  it("leaves handler-owned delegated authorization unevaluated", () => {
    expect(
      buildShadowPolicySide({
        entry: DELEGATED_ENTRY,
        identity: null,
        workspaceId: null,
        workspaceIdSource: null,
      }),
    ).toBe("delegated_to_handler");
  });

  it("constructs the id-free scope declared by an instance policy", () => {
    const instanceEntry: RegistryEntry = {
      ...CAPABILITY_ENTRY,
      policy: {
        capability: "instance:admin",
        scope: "instance",
        scopeSource: "instance",
        reach: { exempt: "no_single_resource", reason: "instance-wide policy" },
      },
    };
    const result = buildShadowPolicySide({
      entry: instanceEntry,
      identity: identity(),
      workspaceId: null,
      workspaceIdSource: null,
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.scope).toEqual({ kind: "instance" });
    expect(result.context.inReach).toBe(NO_SINGLE_RESOURCE);
  });

  it("missing_identity for a capability policy with no resolved identity", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: null,
      workspaceId: "ws_1",
      workspaceIdSource: "row",
    });
    expect(result).toBe("missing_identity");
  });

  it("row_scope_unavailable for a capability policy with no workspaceId on context", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: null,
      workspaceIdSource: null,
    });
    expect(result).toBe("row_scope_unavailable");
  });

  it("builds a real workspace RowScope when workspaceId is present", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.scope).toEqual(
      expect.objectContaining({ kind: "workspace", workspaceId: "ws_1" }),
    );
  });

  it("computes inReach from the already-resolved identity — a member reaches", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.inReach).toBe(true);
  });

  it("computes inReach false for a workspace the identity is not a member of", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_other",
      workspaceIdSource: "row",
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.inReach).toBe(false);
  });

  it("reach_unavailable for a project-scope reach:required policy — no ancestor/team facts", () => {
    const projectEntry: RegistryEntry = {
      ...CAPABILITY_ENTRY,
      policy: {
        ...CAPABILITY_ENTRY.policy,
        scope: "project",
      } as never,
    };
    const result = buildShadowPolicySide({
      entry: projectEntry,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
      projectId: "proj_1",
    });
    expect(result).toBe("reach_unavailable");
  });

  it("can evaluate a project reach when the resolved identity has instance-wide reach", () => {
    const projectEntry: RegistryEntry = {
      ...CAPABILITY_ENTRY,
      policy: {
        ...CAPABILITY_ENTRY.policy,
        scope: "project",
      } as never,
    };
    const result = buildShadowPolicySide({
      entry: projectEntry,
      identity: identity({ reach: { kind: "all" } }),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
      projectId: "proj_1",
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.inReach).toBe(true);
  });

  it("row_scope_unavailable for a project-scope policy with no projectId on context", () => {
    const projectEntry: RegistryEntry = {
      ...CAPABILITY_ENTRY,
      policy: { ...CAPABILITY_ENTRY.policy, scope: "project" } as never,
    };
    const result = buildShadowPolicySide({
      entry: projectEntry,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
      projectId: null,
    });
    expect(result).toBe("row_scope_unavailable");
  });

  it("self_target_unavailable for a self policy", () => {
    const result = buildShadowPolicySide({
      entry: SELF_ENTRY,
      identity: identity(),
      workspaceId: null,
      workspaceIdSource: null,
    });
    expect(result).toBe("self_target_unavailable");
  });

  it("portal_predicate_unavailable for a portal policy", () => {
    const result = buildShadowPolicySide({
      entry: PORTAL_ENTRY,
      identity: identity({ side: "customer", portal: "customer" }),
      workspaceId: null,
      workspaceIdSource: null,
    });
    expect(result).toBe("portal_predicate_unavailable");
  });
});

describe("compareShadowOutcome — the addendum's five categories", () => {
  it("agree: both sides allow", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/health",
      routerGroup: "platform",
      policyKind: "public",
      policyCapability: null,
      identityKind: null,
      workspaceId: null,
      traceId: null,
      legacy: ALLOWED,
      policy: {
        evaluated: true,
        errored: false,
        decision: { allowed: true, requiresElevation: false },
      },
    });
    expect(result).toEqual({ outcome: "agree", reasonCode: null });
  });

  it("agree: both sides deny", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/work-items/{key}",
      routerGroup: "work-item",
      policyKind: "capability",
      policyCapability: "work_item:read",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: null,
      legacy: DENIED_404,
      policy: {
        evaluated: true,
        errored: false,
        decision: {
          allowed: false,
          status: 403,
          code: "capability_denied",
          reason: "no",
        },
      },
    });
    expect(result).toEqual({ outcome: "agree", reasonCode: null });
  });

  it("legacy_allow_policy_deny: the instance-admin bypass width case (#315 S8)", () => {
    // The legacy path bypasses every workspace capability check for an instance admin
    // (require-workspace-permission.ts's isInstanceAdmin() short-circuit); the registry's
    // own evaluator grants instance_admin only instance:* authority (rbac.md § Reach step
    // 1), so it denies a workspace-scoped capability the legacy path let through.
    const result = compareShadowOutcome({
      routeKey: "DELETE /api/workspace/{id}",
      routerGroup: "workspace",
      policyKind: "capability",
      policyCapability: "workspace:delete",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: null,
      legacy: ALLOWED,
      policy: {
        evaluated: true,
        errored: false,
        decision: {
          allowed: false,
          status: 403,
          code: "capability_denied",
          reason: "no",
        },
      },
    });
    expect(result.outcome).toBe("legacy_allow_policy_deny");
    expect(result.reasonCode).toBe("capability_denied");
  });

  it("legacy_deny_policy_allow", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/task/{id}",
      routerGroup: "task",
      policyKind: "capability",
      policyCapability: "work_item:read",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: null,
      legacy: DENIED_403,
      policy: {
        evaluated: true,
        errored: false,
        decision: { allowed: true, requiresElevation: false },
      },
    });
    expect(result).toEqual({
      outcome: "legacy_deny_policy_allow",
      reasonCode: null,
    });
  });

  it("uses the explicit legacy decision when a denied route answers 400", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/project/{id}",
      routerGroup: "project",
      policyKind: "capability",
      policyCapability: "project:read",
      identityKind: "session",
      workspaceId: "ws_other",
      traceId: null,
      legacy: DENIED_400,
      policy: {
        evaluated: true,
        errored: false,
        decision: { allowed: true, requiresElevation: false },
      },
    });
    expect(result).toEqual({
      outcome: "legacy_deny_policy_allow",
      reasonCode: null,
    });
  });

  it("unevaluated: no policy registered", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/nonexistent",
      routerGroup: "unregistered",
      policyKind: null,
      policyCapability: null,
      identityKind: null,
      workspaceId: null,
      traceId: null,
      legacy: ALLOWED,
      policy: {
        evaluated: false,
        errored: false,
        reasonCode: "no_policy_registered",
      },
    });
    expect(result).toEqual({
      outcome: "unevaluated",
      reasonCode: "no_policy_registered",
    });
  });

  it("unevaluated: missing identity (#315 S7 — signed up after boot)", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/work-items/{key}",
      routerGroup: "work-item",
      policyKind: "capability",
      policyCapability: "work_item:read",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: null,
      legacy: ALLOWED,
      policy: {
        evaluated: false,
        errored: false,
        reasonCode: "missing_identity",
      },
    });
    expect(result).toEqual({
      outcome: "unevaluated",
      reasonCode: "missing_identity",
    });
  });

  it("unevaluated: legacy outcome unknown (a non-HTTPException error downstream)", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/work-items/{key}",
      routerGroup: "work-item",
      policyKind: "capability",
      policyCapability: "work_item:read",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: null,
      legacy: UNKNOWN,
      policy: {
        evaluated: true,
        errored: false,
        decision: { allowed: true, requiresElevation: false },
      },
    });
    expect(result).toEqual({
      outcome: "unevaluated",
      reasonCode: "legacy_outcome_unknown",
    });
  });

  it("evaluator_error: the evaluator threw, regardless of the legacy outcome", () => {
    const result = compareShadowOutcome({
      routeKey: "GET /api/work-items/{key}",
      routerGroup: "work-item",
      policyKind: "capability",
      policyCapability: "work_item:read",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: null,
      legacy: ALLOWED,
      policy: { evaluated: false, errored: true, message: "boom" },
    });
    expect(result).toEqual({
      outcome: "evaluator_error",
      reasonCode: "evaluator_threw",
    });
  });
});

describe("#323 Opus S1 — scope provenance branches on the policy's scopeSource", () => {
  const REQUEST_SOURCED: RegistryEntry = {
    routeKey: "GET /api/label/workspace/{workspaceId}",
    kind: "capability",
    source: "apps/api/src/label/policy.ts",
    policy: {
      capability: "work_item:read",
      scope: "workspace",
      scopeSource: "request",
      reach: "required",
    },
  };

  it("a request-sourced workspace policy evaluates without scope_source_mismatch, and agrees for a member", () => {
    const result = buildShadowPolicySide({
      entry: REQUEST_SOURCED,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "request",
    });
    if (typeof result === "string") {
      throw new Error(`expected a context, got ${result}`);
    }
    const decision = evaluatePolicy(result.entry.policy, result.context);
    const code = decision.allowed ? null : decision.code;
    // The OLD bug: workspaceScopeFromRow branded a request value, the evaluator
    // refused at the source check, and every allowed request was filed as a false
    // `legacy_allow_policy_deny` with NO capability comparison ever running.
    expect(code).not.toBe("scope_source_mismatch");
    expect(code).not.toBe("scope_mismatch");
    expect(decision.allowed).toBe(true);

    // …and the comparison lands on `agree`, not on a disagreement bucket.
    const comparison = compareShadowOutcome({
      routeKey: REQUEST_SOURCED.routeKey,
      routerGroup: "label",
      policyKind: "capability",
      policyCapability: "work_item:read",
      identityKind: "session",
      workspaceId: "ws_1",
      traceId: "t-1",
      legacy: ALLOWED,
      policy: { evaluated: true, errored: false, decision },
    });
    expect(comparison).toEqual({ outcome: "agree", reasonCode: null });
  });

  it("a row-sourced workspace policy still builds a row-branded scope", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "row",
    });
    if (typeof result === "string") {
      throw new Error(`expected a context, got ${result}`);
    }
    const decision = evaluatePolicy(result.entry.policy, result.context);
    const code = decision.allowed ? null : decision.code;
    expect(code).not.toBe("scope_source_mismatch");
    expect(code).not.toBe("scope_mismatch");
  });

  it("refuses to evaluate row policy against request-sourced workspace evidence", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_1",
      workspaceIdSource: "request",
    });
    expect(result).toBe("scope_source_unavailable");
  });

  it("a scope-source artifact decision is unevaluated, NEVER filed as a disagreement", () => {
    for (const code of ["scope_source_mismatch", "scope_mismatch"] as const) {
      const comparison = compareShadowOutcome({
        routeKey: REQUEST_SOURCED.routeKey,
        routerGroup: "label",
        policyKind: "capability",
        policyCapability: "work_item:read",
        identityKind: "session",
        workspaceId: "ws_1",
        traceId: "t-1",
        legacy: ALLOWED,
        policy: {
          evaluated: true,
          errored: false,
          decision: { allowed: false, status: 403, code, reason: "Forbidden" },
        },
      });
      expect(comparison).toEqual({
        outcome: "unevaluated",
        reasonCode: "scope_source_unavailable",
      });
    }
  });
});

describe("#323 Opus S3 — normaliseTraceId", () => {
  it("accepts a well-formed caller header", () => {
    expect(normaliseTraceId("abc-123_XYZ.9")).toBe("abc-123_XYZ.9");
  });

  it("rejects an unbounded or malformed header and generates a server id instead", () => {
    const tooLong = "a".repeat(8_007);
    const generatedLong = normaliseTraceId(tooLong);
    expect(generatedLong).not.toBe(tooLong);
    expect(generatedLong).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const generatedSpaces = normaliseTraceId("not valid: here!");
    expect(generatedSpaces).toMatch(/^[0-9a-f]{8}-/);
    const generatedAbsent = normaliseTraceId(undefined);
    expect(generatedAbsent).toMatch(/^[0-9a-f]{8}-/);
  });
});
