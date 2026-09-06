import { describe, expect, it } from "vitest";
import {
  can,
  evaluatePolicy,
  isResolvedScope,
  organisationScopeFromRow,
  type PolicyContext,
  projectScopeFromRow,
  ScopeResolutionError,
  workItemScopeFromRow,
  workspaceScopeFromRequest,
  workspaceScopeFromRow,
} from "./evaluator";
import type { ResolvedIdentity, RoleGrant } from "./identity";
import type { CapabilityPolicy } from "./policy";

/**
 * Finding 4 — `Policy.scope` is declared, validated and documented, but was never read.
 *
 * `evaluatePolicy` used to pass the whole `target` bag to `can()`, and `grantAppliesTo` matched
 * ANY grant whose `scopeId` equalled ANY id that happened to be present on the target,
 * regardless of what the route's `policy.scope` actually declared. Every case below is proven
 * to fail on the code these tests replace — see the scratch-copy proof in the task write-up.
 */

const WORKSPACE_A = "ws-A";
const WORKSPACE_B = "ws-B";
const PROJECT_1 = "prj-1";
const ORG_OTHER = "org-OTHER";
const ORG_A = "org-A";

function grant(overrides: Partial<RoleGrant> = {}): RoleGrant {
  return {
    roleKey: "role",
    scope: "workspace",
    scopeId: WORKSPACE_A,
    rank: 40,
    capabilities: [],
    ...overrides,
  };
}

function identityWith(...grants: RoleGrant[]): ResolvedIdentity {
  return {
    userId: "user-1",
    personId: "person-1",
    side: "staff",
    organisationId: "org-staff",
    portal: "agent",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "membership" },
    authority: grants,
  };
}

function policy(
  overrides: Partial<CapabilityPolicy> &
    Pick<CapabilityPolicy, "capability" | "scope">,
): CapabilityPolicy {
  return {
    reach: { exempt: "no_single_resource", reason: "test fixture" },
    scopeSource: "row",
    ...overrides,
  };
}

function ctx(overrides: Partial<PolicyContext>): PolicyContext {
  return {
    identity: identityWith(),
    target: {},
    ...overrides,
  };
}

describe("scope constructors", () => {
  it("N11 — an empty or blank id is a construction error, never a wildcard", () => {
    expect(() => workspaceScopeFromRow({ workspaceId: "" })).toThrow(
      ScopeResolutionError,
    );
    expect(() =>
      projectScopeFromRow({ projectId: "p", workspaceId: "   " }),
    ).toThrow(ScopeResolutionError);
    expect(() =>
      workItemScopeFromRow({
        workItemId: "",
        projectId: "p",
        workspaceId: "w",
      }),
    ).toThrow(ScopeResolutionError);
  });

  it("N7 — a JSON round trip loses the brand entirely", () => {
    const real = projectScopeFromRow({
      projectId: PROJECT_1,
      workspaceId: WORKSPACE_A,
    });
    const forged = JSON.parse(JSON.stringify(real));
    expect(isResolvedScope(forged)).toBe(false);
  });

  it("N8 — an object spread loses the brand, so a re-pointed copy is not a resolved scope", () => {
    const real = projectScopeFromRow({
      projectId: PROJECT_1,
      workspaceId: WORKSPACE_A,
    });
    const repointed = { ...real, projectId: "prj-victim" };
    expect(isResolvedScope(repointed)).toBe(false);
  });

  it("a hand-built object of the exact same shape is not a resolved scope", () => {
    const handBuilt = { kind: "workspace", workspaceId: WORKSPACE_A };
    expect(isResolvedScope(handBuilt)).toBe(false);
  });
});

describe("evaluatePolicy — scope selection and containment (finding 4)", () => {
  it("N1 — refuses an instance-scope policy when the resolved scope is a workspace", () => {
    const p = policy({
      capability: "instance:manage_plugins",
      scope: "instance",
      scopeSource: "request",
    });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["instance:admin"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: workspaceScopeFromRequest({ workspaceId: WORKSPACE_A }),
      }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      status: 403,
      code: "scope_mismatch",
    });
  });

  it("N2 — refuses a project-scope policy for a project in another workspace", () => {
    const p = policy({ capability: "work_item:create", scope: "project" });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["work_item:create"],
      }),
    );
    const wrongWorkspace = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: projectScopeFromRow({
          projectId: PROJECT_1,
          workspaceId: WORKSPACE_B,
        }),
      }),
    );
    expect(wrongWorkspace).toMatchObject({ allowed: false, status: 403 });

    // N2b — the positive control: same identity, same project, but really in ws-A.
    const rightWorkspace = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: projectScopeFromRow({
          projectId: PROJECT_1,
          workspaceId: WORKSPACE_A,
        }),
      }),
    );
    expect(rightWorkspace.allowed).toBe(true);
  });

  it("N3 — refuses a workspace-scope policy satisfied only by a project grant", () => {
    const p = policy({ capability: "webhook:manage", scope: "workspace" });
    const identity = identityWith(
      grant({
        scope: "project",
        scopeId: PROJECT_1,
        capabilities: ["webhook:manage"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: workspaceScopeFromRow({ workspaceId: "ws-victim" }),
      }),
    );
    expect(decision).toMatchObject({ allowed: false, status: 403 });
  });

  it("N4 — refuses an organisation-scope policy satisfied only by a workspace grant", () => {
    const p = policy({ capability: "work_item:read", scope: "organisation" });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["work_item:read"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: organisationScopeFromRow({ organisationId: ORG_OTHER }),
      }),
    );
    expect(decision).toMatchObject({ allowed: false, status: 403 });
  });

  it("N5 — refuses a capability policy when no scope was resolved at all", () => {
    const p = policy({ capability: "webhook:manage", scope: "workspace" });
    const identity = identityWith(
      grant({
        scope: "instance",
        scopeId: null,
        capabilities: ["webhook:manage"],
      }),
    );
    const decision = evaluatePolicy(p, ctx({ identity, target: {} }));
    expect(decision).toMatchObject({
      allowed: false,
      status: 500,
      code: "policy_context_incomplete",
    });
  });

  it("N6 — refuses a work_item-scope policy when the item's project is not the granted project", () => {
    const p = policy({ capability: "comment:update_any", scope: "work_item" });
    const identity = identityWith(
      grant({
        scope: "project",
        scopeId: PROJECT_1,
        capabilities: ["comment:update_any"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: workItemScopeFromRow({
          workItemId: "wi-1",
          projectId: "prj-VICTIM",
          workspaceId: WORKSPACE_A,
        }),
      }),
    );
    expect(decision).toMatchObject({ allowed: false, status: 403 });
  });

  it("N9 — an orOwner branch cannot escape the scope either", () => {
    const p = policy({
      capability: "comment:update_any",
      scope: "work_item",
      orOwner: {
        predicate: "row.person_id === identity.personId",
        capability: "comment:update_own",
      },
    });
    const identity = identityWith(
      grant({
        scope: "project",
        scopeId: PROJECT_1,
        capabilities: ["comment:update_own"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        row: { personId: "person-1" },
        scope: workItemScopeFromRow({
          workItemId: "wi-1",
          projectId: "prj-Y",
          workspaceId: WORKSPACE_A,
        }),
      }),
    );
    expect(decision.allowed).toBe(false);
  });

  it("N10 — a malformed instance grant carrying a scopeId does not mean everywhere", () => {
    const malformed = identityWith(
      grant({
        scope: "instance",
        scopeId: WORKSPACE_A,
        capabilities: ["webhook:manage"],
      }),
    );
    const wellFormed = identityWith(
      grant({
        scope: "instance",
        scopeId: null,
        capabilities: ["webhook:manage"],
      }),
    );
    expect(
      can(malformed, "webhook:manage", "workspace", {
        workspaceId: WORKSPACE_A,
      }),
    ).toBe(false);
    expect(
      can(wellFormed, "webhook:manage", "workspace", {
        workspaceId: WORKSPACE_A,
      }),
    ).toBe(true);
  });

  it("N13 — an organisation grant does not reach a project it is the customer of", () => {
    const identity = identityWith(
      grant({
        scope: "organisation",
        scopeId: ORG_A,
        capabilities: ["work_item:read"],
      }),
    );
    expect(
      can(identity, "work_item:read", "project", {
        projectId: "p",
        workspaceId: "w",
      }),
    ).toBe(false);
    expect(
      can(identity, "work_item:read", "organisation", {
        organisationId: ORG_A,
      }),
    ).toBe(true);
  });

  it("positive control — instance roles still apply everywhere, and the project override still overrides", () => {
    const instanceAdmin = identityWith(
      grant({
        scope: "instance",
        scopeId: null,
        capabilities: ["instance:admin"],
      }),
    );
    expect(can(instanceAdmin, "instance:manage_plugins", "instance", {})).toBe(
      true,
    );

    const both = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["work_item:delete"],
      }),
      grant({
        scope: "project",
        scopeId: PROJECT_1,
        capabilities: ["work_item:read"],
      }),
    );
    expect(
      can(both, "work_item:delete", "workspace", { workspaceId: WORKSPACE_A }),
    ).toBe(true);
    expect(
      can(both, "work_item:delete", "project", {
        workspaceId: WORKSPACE_A,
        projectId: PROJECT_1,
      }),
    ).toBe(false);
  });
});

describe("evaluatePolicy — scope source (finding 4 arbitration)", () => {
  it("refuses a request-sourced scope for a scopeSource: row policy", () => {
    const p = policy({
      capability: "workspace:manage_settings",
      scope: "workspace",
      scopeSource: "row",
    });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["workspace:manage_settings"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: workspaceScopeFromRequest({ workspaceId: WORKSPACE_A }),
      }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      status: 403,
      code: "scope_source_mismatch",
    });
  });

  it("closes the DELETE /api/webhooks/{id}-shaped case: a header-legitimate workspace cannot stand in for the addressed row", () => {
    // The arbitration's concrete example: an admin of ws-A sends X-Workspace-Id: ws-A and tries
    // to reach a webhook that actually belongs to a different workspace. scopeSource: "row"
    // means only the addressed row's own workspace id can satisfy this — never the header,
    // however legitimately the caller holds it.
    const p = policy({
      capability: "webhook:manage",
      scope: "workspace",
      scopeSource: "row",
    });
    const legitimateAdminOfWsA = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["webhook:manage"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity: legitimateAdminOfWsA,
        // The middleware forgot to load the row and used the header instead.
        scope: workspaceScopeFromRequest({ workspaceId: WORKSPACE_A }),
      }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: "scope_source_mismatch",
    });
  });

  it("accepts a row-sourced scope for a scopeSource: row policy", () => {
    const p = policy({
      capability: "webhook:manage",
      scope: "workspace",
      scopeSource: "row",
    });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["webhook:manage"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: workspaceScopeFromRow({ workspaceId: WORKSPACE_A }),
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("accepts a request-sourced scope for a scopeSource: request policy (a collection route)", () => {
    const p = policy({
      capability: "webhook:manage",
      scope: "workspace",
      scopeSource: "request",
      reach: {
        exempt: "no_single_resource",
        reason: "a collection, not a row",
      },
    });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["webhook:manage"],
      }),
    );
    const decision = evaluatePolicy(
      p,
      ctx({
        identity,
        scope: workspaceScopeFromRequest({ workspaceId: WORKSPACE_A }),
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("N7-through-evaluatePolicy — a forged scope object is refused, not trusted", () => {
    const p = policy({
      capability: "work_item:create",
      scope: "project",
      scopeSource: "row",
    });
    const identity = identityWith(
      grant({
        scope: "workspace",
        scopeId: WORKSPACE_A,
        capabilities: ["work_item:create"],
      }),
    );
    const forged = JSON.parse(
      JSON.stringify(
        projectScopeFromRow({ projectId: PROJECT_1, workspaceId: WORKSPACE_A }),
      ),
    );
    const decision = evaluatePolicy(p, ctx({ identity, scope: forged }));
    expect(decision).toMatchObject({
      allowed: false,
      status: 500,
      code: "policy_context_incomplete",
    });
  });

  it("does not claim the mismatch is unrepresentable — a caller can still mislabel the constructor", () => {
    // Documents the arbitration's own caveat rather than a vulnerability: nothing in the type
    // system stops a caller from passing a header value into `...FromRow`. The evaluator's
    // check only catches an HONEST `...FromRequest` value reaching a `scopeSource: "row"`
    // policy — it cannot catch a lie at the call site. That is a code-review question.
    const headerValue = WORKSPACE_A;
    const mislabelled = workspaceScopeFromRow({ workspaceId: headerValue });
    expect(isResolvedScope(mislabelled)).toBe(true);
    expect(mislabelled.kind).toBe("workspace");
  });
});
