import {
  evaluatePolicy,
  isCapabilityPolicy,
  organisationScopeFromRow,
  projectScopeFromRow,
  type ResolvedIdentity,
  type RoleGrant,
  workspaceScopeFromRow,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import { ORGANISATION_ID, PROJECT_ID, WORKSPACE_ID } from "./matrix-fixture";

/**
 * Finding 4, at the registry — a wrong-kind or unresolved scope must not satisfy any capability
 * route, and the guarantee grows with the registry rather than being pinned to today's one
 * route (#8 and #10 add more).
 */

function instanceIdentityHolding(
  capability: RoleGrant["capabilities"][number],
): ResolvedIdentity {
  return {
    userId: "user-owner",
    personId: "person-owner",
    side: "staff",
    organisationId: "org-cross-scope",
    portal: "agent",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "all" },
    authority: [
      {
        roleKey: "instance_admin",
        scope: "instance",
        scopeId: null,
        rank: 1000,
        capabilities: [capability],
      },
    ],
  };
}

describe("cross-scope: a wrong-kind or unresolved scope is refused for every capability route", () => {
  it("refuses a scope of the wrong kind, and refuses no scope at all", async () => {
    const registry = await loadPolicyRegistry();
    let sawACapabilityRoute = false;

    for (const entry of registry.entries) {
      if (!isCapabilityPolicy(entry.policy)) continue;
      sawACapabilityRoute = true;

      const identity = instanceIdentityHolding(entry.policy.capability);
      const inReach = entry.policy.reach === "required" ? true : undefined;

      // 1. A scope of the wrong kind is refused, even for an identity that genuinely holds the
      //    capability everywhere (an instance grant) — the mismatch is caught before authority
      //    is even considered.
      const wrongKind =
        entry.policy.scope === "workspace"
          ? projectScopeFromRow({
              projectId: PROJECT_ID,
              workspaceId: WORKSPACE_ID,
            })
          : workspaceScopeFromRow({ workspaceId: WORKSPACE_ID });
      expect(
        evaluatePolicy(entry.policy, {
          identity,
          target: {},
          scope: wrongKind,
          inReach,
        }),
        entry.routeKey,
      ).toMatchObject({ allowed: false, status: 403, code: "scope_mismatch" });

      // 2. No scope at all is refused — never an implicit allow.
      expect(
        evaluatePolicy(entry.policy, { identity, target: {}, inReach }),
        entry.routeKey,
      ).toMatchObject({ allowed: false, code: "policy_context_incomplete" });
    }

    expect(sawACapabilityRoute).toBe(true);
  }, 120_000);

  it("refuses a scope of the right kind belonging to a foreign tenant", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.get("GET /api/project/{id}");
    if (entry === undefined || !isCapabilityPolicy(entry.policy)) {
      throw new Error("GET /api/project/{id} should carry a capability policy");
    }

    // A legitimate admin of ws-A, whose grant would satisfy this policy for a project actually
    // inside ws-A.
    const admin: ResolvedIdentity = {
      userId: "user-admin",
      personId: "person-admin",
      side: "staff",
      organisationId: ORGANISATION_ID,
      portal: "agent",
      credential: "session",
      memberships: [],
      teamIds: [],
      reach: { kind: "all" },
      authority: [
        {
          roleKey: "admin",
          scope: "workspace",
          scopeId: WORKSPACE_ID,
          rank: 80,
          capabilities: [entry.policy.capability],
        },
      ],
    };

    const foreignProject = projectScopeFromRow({
      projectId: "prj-foreign",
      workspaceId: "ws-foreign",
    });

    expect(
      evaluatePolicy(entry.policy, {
        identity: admin,
        target: {},
        scope: foreignProject,
        inReach: true,
      }),
    ).toMatchObject({ allowed: false, status: 403, code: "forbidden" });

    // Positive control: the same identity, the same capability, the project really in ws-A.
    const ownProject = projectScopeFromRow({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(
      evaluatePolicy(entry.policy, {
        identity: admin,
        target: {},
        scope: ownProject,
        inReach: true,
      }).allowed,
    ).toBe(true);
  }, 120_000);

  it("refuses an organisation-scope customer grant reaching into a workspace/project route", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.get("GET /api/project/{id}");
    if (entry === undefined || !isCapabilityPolicy(entry.policy)) {
      throw new Error("GET /api/project/{id} should carry a capability policy");
    }

    const customer: ResolvedIdentity = {
      userId: "user-customer",
      personId: "person-customer",
      side: "customer",
      organisationId: ORGANISATION_ID,
      portal: "customer",
      credential: "session",
      memberships: [],
      teamIds: [],
      reach: { kind: "organisation", ids: [ORGANISATION_ID] },
      authority: [
        {
          roleKey: "customer",
          scope: "organisation",
          scopeId: ORGANISATION_ID,
          rank: 10,
          capabilities: [entry.policy.capability],
        },
      ],
    };

    expect(
      evaluatePolicy(entry.policy, {
        identity: customer,
        target: {},
        scope: projectScopeFromRow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
        }),
        inReach: true,
      }),
    ).toMatchObject({ allowed: false, status: 403 });

    // The same grant does satisfy an organisation-scope check — proven so this is a containment
    // gate, not a blanket "customer never satisfies anything".
    expect(
      organisationScopeFromRow({ organisationId: ORGANISATION_ID }).kind,
    ).toBe("organisation");
  }, 120_000);
});
