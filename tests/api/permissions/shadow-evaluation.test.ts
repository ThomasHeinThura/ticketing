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
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  buildShadowPolicySide,
  compareShadowOutcome,
  isLegacyDenialStatus,
  type LegacyOutcome,
} from "../../../apps/api/src/permissions/shadow-evaluation";

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

const SELF_ENTRY: RegistryEntry = {
  routeKey: "GET /api/user/{id}",
  kind: "self",
  source: "apps/api/src/user/policy.ts",
  policy: { authenticated: true, self: true, personParam: "id" },
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
const DENIED_404: LegacyOutcome = { known: true, allowed: false, status: 404 };
const UNKNOWN: LegacyOutcome = { known: false };

describe("isLegacyDenialStatus", () => {
  it("treats 401/403/404 as denial", () => {
    expect(isLegacyDenialStatus(401)).toBe(true);
    expect(isLegacyDenialStatus(403)).toBe(true);
    expect(isLegacyDenialStatus(404)).toBe(true);
  });

  it("treats 2xx, validation 4xx and 5xx as allowed-through", () => {
    expect(isLegacyDenialStatus(200)).toBe(false);
    expect(isLegacyDenialStatus(204)).toBe(false);
    expect(isLegacyDenialStatus(400)).toBe(false);
    expect(isLegacyDenialStatus(500)).toBe(false);
  });
});

describe("buildShadowPolicySide", () => {
  it("no_policy_registered when the registry has no entry for this route", () => {
    const result = buildShadowPolicySide({
      entry: undefined,
      identity: identity(),
      workspaceId: "ws_1",
    });
    expect(result).toBe("no_policy_registered");
  });

  it("evaluates a public policy with no identity at all", () => {
    const result = buildShadowPolicySide({
      entry: PUBLIC_ENTRY,
      identity: null,
      workspaceId: null,
    });
    expect(result).not.toBe("no_policy_registered");
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.identity).toBeNull();
  });

  it("missing_identity for a capability policy with no resolved identity", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: null,
      workspaceId: "ws_1",
    });
    expect(result).toBe("missing_identity");
  });

  it("row_scope_unavailable for a capability policy with no workspaceId on context", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: null,
    });
    expect(result).toBe("row_scope_unavailable");
  });

  it("builds a real workspace RowScope when workspaceId is present", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_1",
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
    });
    if (typeof result === "string") throw new Error("expected a context");
    expect(result.context.inReach).toBe(true);
  });

  it("computes inReach false for a workspace the identity is not a member of", () => {
    const result = buildShadowPolicySide({
      entry: CAPABILITY_ENTRY,
      identity: identity(),
      workspaceId: "ws_other",
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
      projectId: "proj_1",
    });
    expect(result).toBe("reach_unavailable");
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
      projectId: null,
    });
    expect(result).toBe("row_scope_unavailable");
  });

  it("self_target_unavailable for a self policy", () => {
    const result = buildShadowPolicySide({
      entry: SELF_ENTRY,
      identity: identity(),
      workspaceId: null,
    });
    expect(result).toBe("self_target_unavailable");
  });

  it("portal_predicate_unavailable for a portal policy", () => {
    const result = buildShadowPolicySide({
      entry: PORTAL_ENTRY,
      identity: identity({ side: "customer", portal: "customer" }),
      workspaceId: null,
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
