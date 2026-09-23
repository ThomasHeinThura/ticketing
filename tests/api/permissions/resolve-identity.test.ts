/**
 * Exhaustive unit tests for the PURE half of `resolveIdentity` — issue #8, Slice 1.
 * No database: every case constructs `IdentityFacts` directly. The loader (the I/O half)
 * has its own integration test, `tests/api-integration/resolve-identity.test.ts`.
 */
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  type IdentityFacts,
  type PersonFact,
  resolveIdentityFromFacts,
} from "../../../apps/api/src/permissions/resolve-identity";

const STAFF_PERSON: PersonFact = {
  personId: "person-1",
  organisationId: "org-internal",
  side: "staff",
  active: true,
};

const CUSTOMER_PERSON: PersonFact = {
  personId: "person-2",
  organisationId: "org-acme",
  side: "customer",
  active: true,
};

function facts(overrides: Partial<IdentityFacts> = {}): IdentityFacts {
  return {
    userId: "user-1",
    person: STAFF_PERSON,
    isInstanceAdmin: false,
    workspaceMemberships: [],
    teamIds: [],
    credential: "session",
    ...overrides,
  };
}

describe("resolveIdentityFromFacts — a member with each built-in workspace role", () => {
  const workspaceRoles = [
    "owner",
    "admin",
    "manager",
    "lead",
    "member",
    "viewer",
  ] as const;

  for (const role of workspaceRoles) {
    it(`resolves ${role}'s membership and authority`, () => {
      const identity = resolveIdentityFromFacts(
        facts({
          workspaceMemberships: [{ workspaceId: "ws-1", role, seesAll: false }],
        }),
      );

      expect(identity).not.toBeNull();
      expect(identity?.memberships).toEqual([
        { scope: "workspace", scopeId: "ws-1", seesAll: false },
      ]);
      expect(identity?.authority).toEqual([
        {
          roleKey: role,
          scope: "workspace",
          scopeId: "ws-1",
          rank: BUILT_IN_ROLES[role].rank,
          capabilities: BUILT_IN_ROLES[role].capabilities,
        },
      ]);
      expect(identity?.reach).toEqual({ kind: "membership" });
    });
  }
});

describe("resolveIdentityFromFacts — a non-member", () => {
  it("resolves an identity with no memberships and no authority", () => {
    const identity = resolveIdentityFromFacts(facts());

    expect(identity).not.toBeNull();
    expect(identity?.memberships).toEqual([]);
    expect(identity?.authority).toEqual([]);
    expect(identity?.reach).toEqual({ kind: "membership" });
  });
});

describe("resolveIdentityFromFacts — a multi-workspace user", () => {
  it("resolves one membership and one grant per workspace", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "admin", seesAll: false },
          { workspaceId: "ws-2", role: "viewer", seesAll: false },
        ],
      }),
    );

    expect(identity?.memberships).toEqual([
      { scope: "workspace", scopeId: "ws-1", seesAll: false },
      { scope: "workspace", scopeId: "ws-2", seesAll: false },
    ]);
    expect(identity?.authority.map((grant) => grant.roleKey)).toEqual([
      "admin",
      "viewer",
    ]);
  });

  it("skips a workspace whose membership rows are ambiguous, and keeps the others", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "admin", seesAll: false },
          { workspaceId: "ws-1", role: "viewer", seesAll: false },
          { workspaceId: "ws-2", role: "member", seesAll: false },
        ],
      }),
    );

    expect(identity?.authority.map((grant) => grant.scopeId)).toEqual(["ws-2"]);
  });

  it("skips a workspace whose stored role value is malformed (issue #82)", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "owner,admin", seesAll: false },
          { workspaceId: "ws-2", role: "member", seesAll: false },
        ],
      }),
    );

    expect(identity?.authority.map((grant) => grant.scopeId)).toEqual(["ws-2"]);
  });

  it("skips a workspace whose role name is not a recognised built-in role", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "custom-triage-lead", seesAll: false },
        ],
      }),
    );

    expect(identity?.authority).toEqual([]);
    expect(identity?.memberships).toEqual([]);
  });
});

describe("resolveIdentityFromFacts — sees_all", () => {
  it("grants reach 'all' when any membership carries sees_all, even with no other role", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "viewer", seesAll: true },
        ],
      }),
    );

    expect(identity?.reach).toEqual({ kind: "all" });
    // sees_all is reach only -- it must not appear as, or imply, any extra authority.
    expect(identity?.authority).toEqual([
      {
        roleKey: "viewer",
        scope: "workspace",
        scopeId: "ws-1",
        rank: BUILT_IN_ROLES.viewer.rank,
        capabilities: BUILT_IN_ROLES.viewer.capabilities,
      },
    ]);
  });

  it("does not grant reach 'all' when no membership carries sees_all", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "admin", seesAll: false },
        ],
      }),
    );

    expect(identity?.reach).toEqual({ kind: "membership" });
  });

  it("instance:admin also grants reach 'all', independently of sees_all", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        isInstanceAdmin: true,
        workspaceMemberships: [],
      }),
    );

    expect(identity?.reach).toEqual({ kind: "all" });
    expect(identity?.authority).toEqual([
      {
        roleKey: "instance_admin",
        scope: "instance",
        scopeId: null,
        rank: BUILT_IN_ROLES.instance_admin.rank,
        capabilities: BUILT_IN_ROLES.instance_admin.capabilities,
      },
    ]);
  });
});

describe("resolveIdentityFromFacts — API-key clamping", () => {
  it("passes through a persisted subset narrower than the owner's role, unmodified", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        credential: "api_key",
        apiKey: { enabled: true, capabilities: ["work_item:read"] },
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "admin", seesAll: false },
        ],
      }),
    );

    // The owner holds far more than `work_item:read` via `admin` -- resolveIdentity does
    // not compute the intersection itself (that is `can()`'s job); it only has to supply
    // the frozen subset faithfully, never widened.
    expect(identity?.keyCapabilities).toEqual(["work_item:read"]);
    expect(identity?.authority[0]?.capabilities).not.toEqual([
      "work_item:read",
    ]);
  });

  it("mcp_key behaves identically to api_key: never undefined, never widened", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        credential: "mcp_key",
        apiKey: { enabled: true, capabilities: ["work_item:read"] },
      }),
    );

    expect(identity?.credential).toBe("mcp_key");
    expect(identity?.keyCapabilities).toEqual(["work_item:read"]);
  });

  it("clamps to an EMPTY subset, never the owner's full RBAC, when no subset was loaded", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        credential: "api_key",
        apiKey: { enabled: true },
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "owner", seesAll: false },
        ],
      }),
    );

    expect(identity?.keyCapabilities).toEqual([]);
    expect(identity?.keyCapabilities).not.toBeUndefined();
  });

  it("MUTATION GUARD: keyCapabilities must never be undefined for a key credential", () => {
    // This is the exact invariant `identity.ts` and `can()` depend on. Widening the
    // implementation to `apiKey?.capabilities` (dropping the `?? []`) must fail this test.
    const identity = resolveIdentityFromFacts(
      facts({ credential: "api_key", apiKey: { enabled: true } }),
    );
    expect(identity?.keyCapabilities).toBeDefined();
  });

  it("session and impersonation credentials never carry keyCapabilities at all", () => {
    expect(
      resolveIdentityFromFacts(facts({ credential: "session" }))
        ?.keyCapabilities,
    ).toBeUndefined();
    expect(
      resolveIdentityFromFacts(facts({ credential: "impersonation" }))
        ?.keyCapabilities,
    ).toBeUndefined();
  });
});

describe("resolveIdentityFromFacts — an API key on a revoked or disabled owner", () => {
  it("refuses when the key's owner is deactivated", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        credential: "api_key",
        person: { ...STAFF_PERSON, active: false },
        apiKey: { enabled: true },
      }),
    );

    expect(identity).toBeNull();
  });

  it("refuses when the key itself is disabled, even for an active owner", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        credential: "api_key",
        apiKey: { enabled: false },
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "owner", seesAll: false },
        ],
      }),
    );

    expect(identity).toBeNull();
  });
});

describe("resolveIdentityFromFacts — a portal (customer) session", () => {
  it("holds exactly the built-in customer grant, and reach scoped to its own organisation", () => {
    const identity = resolveIdentityFromFacts(
      facts({ person: CUSTOMER_PERSON, workspaceMemberships: [] }),
    );

    expect(identity?.side).toBe("customer");
    expect(identity?.portal).toBe("customer");
    expect(identity?.reach).toEqual({
      kind: "organisation",
      ids: ["org-acme"],
    });
    expect(identity?.authority).toEqual([
      {
        roleKey: "customer",
        scope: "organisation",
        scopeId: "org-acme",
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: BUILT_IN_ROLES.customer.capabilities,
      },
    ]);
    expect(identity?.memberships).toEqual([]);
  });

  it("never gains an agent role, even if a workspace_member row exists for this user", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        person: CUSTOMER_PERSON,
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "owner", seesAll: false },
        ],
      }),
    );

    expect(identity?.authority).toEqual([
      {
        roleKey: "customer",
        scope: "organisation",
        scopeId: "org-acme",
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: BUILT_IN_ROLES.customer.capabilities,
      },
    ]);
    expect(identity?.authority.some((grant) => grant.roleKey === "owner")).toBe(
      false,
    );
  });

  it("ignores instance-admin for a customer -- side determines identity kind first", () => {
    const identity = resolveIdentityFromFacts(
      facts({ person: CUSTOMER_PERSON, isInstanceAdmin: true }),
    );

    expect(identity?.side).toBe("customer");
    expect(
      identity?.authority.some((grant) => grant.roleKey === "instance_admin"),
    ).toBe(false);
  });
});

describe("resolveIdentityFromFacts — anonymous", () => {
  it("resolves to null: no person row means no identity, not a low-authority one", () => {
    const identity = resolveIdentityFromFacts(facts({ person: null }));
    expect(identity).toBeNull();
  });
});

describe("resolveIdentityFromFacts — a deactivated member", () => {
  it("resolves to null even with real memberships and roles on file", () => {
    const identity = resolveIdentityFromFacts(
      facts({
        person: { ...STAFF_PERSON, active: false },
        workspaceMemberships: [
          { workspaceId: "ws-1", role: "owner", seesAll: false },
        ],
        isInstanceAdmin: true,
      }),
    );

    expect(identity).toBeNull();
  });
});
