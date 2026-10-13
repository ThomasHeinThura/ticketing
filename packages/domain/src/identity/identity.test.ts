import { describe, expect, it } from "vitest";
import {
  applyScimPatchOps,
  decideProvisioningTransition,
  mapExternalGroupsToRoles,
  normaliseEntraClaims,
  parseScimUser,
  scimConflictResponse,
  validateIdentityConnection,
  validateScimPutExternalId,
} from "./identity.js";
import { canReachCustomerPortalResource } from "./portal.js";
import type {
  IdentityConnectionContext,
  IdentityConnectionDraft,
  IdentityDomainOwner,
  IdentityRoleMapping,
  VerifiedEntraClaims,
} from "./types.js";

const TENANT_ID = "12345678-1234-1234-1234-123456789012";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const CONNECTION_ID = "connection-1";
const ADMISSION_POLICY = {
  enabled: false,
  default_role_id: null,
  required_entra_app_role: "taskdesk.staff",
};

function connection(
  overrides: Partial<IdentityConnectionDraft> = {},
): IdentityConnectionContext & IdentityConnectionDraft {
  return {
    identityConnectionId: CONNECTION_ID,
    portalScope: "agent",
    organisationId: null,
    tenantId: TENANT_ID,
    issuer: ISSUER,
    maxRoleRank: 3,
    defaultRoleRank: 1,
    defaultRoleIsCustomer: false,
    ...overrides,
  };
}

function normalise(
  identityClaims: VerifiedEntraClaims,
  identityConnection = connection(),
  domainOwners: readonly IdentityDomainOwner[] = [],
) {
  return normaliseEntraClaims(
    identityClaims,
    identityConnection,
    domainOwners,
    {
      jitPolicy: ADMISSION_POLICY,
    },
  );
}

function claims(
  overrides: Partial<VerifiedEntraClaims> = {},
): VerifiedEntraClaims {
  return {
    iss: ISSUER,
    tid: TENANT_ID,
    oid: "person-object-id",
    preferred_username: " User@Example.com ",
    roles: ["taskdesk.staff"],
    acct: 0,
    ...overrides,
  };
}

function scimUser(overrides: Record<string, unknown> = {}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: "person",
    ...overrides,
  };
}

describe("P3 identity core", () => {
  it("IP-26/IP-27: binds the Entra subject to tenant and issuer, then applies address precedence", () => {
    expect(
      normalise(claims({ email: "first@example.com" }), connection()),
    ).toEqual({
      ok: true,
      identity: {
        subject: { oid: "person-object-id", tid: TENANT_ID },
        address: "first@example.com",
        addressUsed: "email",
        groupObjectIds: { kind: "missing" },
      },
    });
    expect(normalise(claims({ tid: "another-tenant" }), connection())).toEqual({
      ok: false,
      reason: "tenant_mismatch",
    });
    expect(
      normalise(
        claims({ iss: "https://login.microsoftonline.com/common/v2.0" }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "issuer_mismatch" });
  });

  it("IP-27: maps only the fixed optional profile name and refuses malformed stored maps", () => {
    expect(normalise(claims({ name: "  Casey Staff  " }))).toMatchObject({
      ok: true,
      identity: { displayName: "Casey Staff" },
    });
    expect(
      normaliseEntraClaims(claims({ name: "Casey" }), connection(), [], {
        claimMapping: { version: 1, displayName: "email" },
        jitPolicy: ADMISSION_POLICY,
      }),
    ).toEqual({ ok: false, reason: "invalid_claim_mapping" });
  });

  it("IP-27: checks exact Entra admission before normalized identity is usable", () => {
    expect(normalise(claims({ roles: ["other"] }))).toEqual({
      ok: false,
      reason: "missing_app_role",
    });
    expect(normalise(claims({ acct: 1 }))).toEqual({
      ok: false,
      reason: "guest_account",
    });
    expect(
      normaliseEntraClaims(claims(), connection(), [], {
        jitPolicy: { enabled: false },
      }),
    ).toEqual({ ok: false, reason: "invalid_admission_policy" });
  });

  it("IP-9/IP-27: falls back through usable addresses and fails closed without one", () => {
    expect(
      normalise(
        claims({
          email: "invalid",
          preferred_username: "also invalid",
          upn: "Last@Example.com",
        }),
        connection(),
      ),
    ).toMatchObject({
      ok: true,
      identity: { address: "last@example.com", addressUsed: "upn" },
    });
    expect(
      normalise(
        claims({ preferred_username: "not-an-email", upn: "also invalid" }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "no_usable_address" });
    expect(
      normalise(
        claims({ email: "person@example.com", email_verified: false }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "unverified_address" });
    expect(
      normalise(
        claims({
          email: `${"a".repeat(200_000)}!@example.com`,
          preferred_username: "invalid",
          upn: "invalid",
        }),
        connection(),
      ),
    ).toMatchObject({ ok: false, reason: "no_usable_address" });
  });

  it("IP-9/IP-27: refuses only domains owned by another or ambiguous connection", () => {
    const currentConnection = connection();
    expect(
      normalise(
        claims({
          email: "first@EXAMPLE.com",
          preferred_username: "other@else.com",
        }),
        currentConnection,
        [{ domain: "example.COM", identityConnectionId: CONNECTION_ID }],
      ),
    ).toMatchObject({ ok: true, identity: { address: "first@example.com" } });

    expect(
      normalise(claims({ email: "person@example.com" }), currentConnection, [
        { domain: "example.com", identityConnectionId: "connection-2" },
      ]),
    ).toEqual({ ok: false, reason: "domain_bound_elsewhere" });

    expect(
      normalise(
        claims({ email: "person@unbound.example" }),
        currentConnection,
        [{ domain: "elsewhere.example", identityConnectionId: "connection-2" }],
      ),
    ).toMatchObject({
      ok: true,
      identity: { address: "person@unbound.example" },
    });

    expect(
      normalise(claims({ email: "person@example.com" }), currentConnection, [
        { domain: "EXAMPLE.COM", identityConnectionId: CONNECTION_ID },
      ]),
    ).toMatchObject({ ok: true, identity: { address: "person@example.com" } });

    expect(
      normalise(claims({ email: "person@example.com" }), currentConnection, [
        { domain: "example.com", identityConnectionId: CONNECTION_ID },
        { domain: "EXAMPLE.COM", identityConnectionId: "connection-2" },
      ]),
    ).toEqual({ ok: false, reason: "ambiguous_domain_binding" });
  });

  it("IP-9/IP-27: rejects trailing-dot addresses and malformed configured bindings", () => {
    expect(
      normalise(
        claims({
          email: "person@example.com.",
          preferred_username: "invalid",
          upn: "also invalid",
        }),
        connection(),
        [{ domain: "example.com", identityConnectionId: "connection-2" }],
      ),
    ).toEqual({ ok: false, reason: "no_usable_address" });

    expect(
      normalise(claims({ email: "person@example.com" }), connection(), [
        { domain: "example.com.", identityConnectionId: "connection-2" },
      ]),
    ).toEqual({ ok: false, reason: "ambiguous_domain_binding" });
  });

  it.each([
    "example.com ",
    "example..com",
    ".example.com",
    "example.com.",
    "-example.com",
    "example-.com",
    "example.c_m",
    `${"a".repeat(64)}.com`,
  ])("IP-9: fails closed for malformed configured domain %s", (domain) => {
    expect(
      normalise(claims({ email: "person@example.com" }), connection(), [
        { domain, identityConnectionId: "connection-2" },
      ]),
    ).toEqual({ ok: false, reason: "ambiguous_domain_binding" });
  });

  it.each([undefined, "", "   "])(
    "IP-9: rejects matching bindings with an empty owner id %s",
    (identityConnectionId) => {
      const malformedOwner = {
        domain: "example.com",
        identityConnectionId,
      } as unknown as IdentityDomainOwner;

      expect(
        normalise(claims({ email: "person@example.com" }), connection(), [
          malformedOwner,
        ]),
      ).toEqual({ ok: false, reason: "ambiguous_domain_binding" });
    },
  );

  it("IP-9: rejects duplicate matching bindings when an owner id is missing", () => {
    const missingOwner = {
      domain: "example.com",
    } as unknown as IdentityDomainOwner;
    expect(
      normalise(claims({ email: "person@example.com" }), connection(), [
        { domain: "EXAMPLE.COM", identityConnectionId: CONNECTION_ID },
        missingOwner,
      ]),
    ).toEqual({ ok: false, reason: "ambiguous_domain_binding" });
  });

  it("IP-9: rejects configured bindings with missing or non-string domains", () => {
    const malformedBindings = [
      { identityConnectionId: "connection-2" },
      { domain: null, identityConnectionId: "connection-2" },
      { domain: 42, identityConnectionId: "connection-2" },
      null,
    ] as unknown as IdentityDomainOwner[];

    for (const binding of malformedBindings) {
      expect(
        normalise(claims({ email: "person@example.com" }), connection(), [
          binding,
        ]),
      ).toEqual({ ok: false, reason: "ambiguous_domain_binding" });
    }
  });

  it("IP-28: canonicalizes complete UUID group lists and treats malformed or overage claims as no groups", () => {
    const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(
      normalise(
        claims({ groups: [first.toUpperCase(), first, second] }),
        connection(),
      ),
    ).toMatchObject({
      ok: true,
      identity: {
        groupObjectIds: { kind: "complete", objectIds: [first, second] },
      },
    });
    expect(
      normalise(
        claims({ groups: ["ignored"], _claim_names: { groups: "src1" } }),
        connection(),
      ),
    ).toMatchObject({
      ok: true,
      identity: { groupObjectIds: { kind: "overage" } },
    });
    expect(
      normalise(claims({ groups: "display-name" }), connection()),
    ).toMatchObject({
      ok: true,
      identity: { groupObjectIds: { kind: "malformed" } },
    });
    expect(
      normalise(claims({ _claim_names: { groups: null } }), connection()),
    ).toMatchObject({
      ok: true,
      identity: { groupObjectIds: { kind: "overage" } },
    });
    expect(normalise(claims(), connection())).toMatchObject({
      ok: true,
      identity: { groupObjectIds: { kind: "missing" } },
    });
    expect(normalise(claims({ groups: [] }), connection())).toMatchObject({
      ok: true,
      identity: { groupObjectIds: { kind: "complete", objectIds: [] } },
    });
    expect(
      normalise(claims({ groups: [first, "malformed"] }), connection()),
    ).toMatchObject({
      ok: true,
      identity: { groupObjectIds: { kind: "malformed" } },
    });
  });

  it("IP-1/IP-2/IP-3/IP-26: validates portal scope, tenant issuer and role ceiling before persistence", () => {
    expect(validateIdentityConnection(connection())).toMatchObject({
      ok: true,
    });
    expect(
      validateIdentityConnection(
        connection({
          portalScope: "customer",
          organisationId: null,
          maxRoleRank: null,
          defaultRoleIsCustomer: true,
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateIdentityConnection(connection({ organisationId: "org-1" })).ok,
    ).toBe(false);
    expect(
      validateIdentityConnection(
        connection({
          portalScope: "customer",
          organisationId: "org-1",
          maxRoleRank: null,
          defaultRoleIsCustomer: true,
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateIdentityConnection(
        connection({ issuer: "https://login.microsoftonline.com/common/v2.0" }),
      ),
    ).toMatchObject({
      ok: false,
      errors: ["multi_tenant_issuer_forbidden"],
    });
    expect(
      validateIdentityConnection(connection({ defaultRoleRank: 4 })),
    ).toMatchObject({ ok: false, errors: ["default_role_exceeds_maximum"] });
    expect(
      validateIdentityConnection(connection({ maxRoleRank: Number.NaN })),
    ).toMatchObject({ ok: false, errors: ["invalid_role_rank"] });
    expect(
      validateIdentityConnection(
        connection({
          tenantId: "9188040d-6c67-4c5b-b112-36a304b66dad",
          issuer:
            "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
        }),
      ),
    ).toMatchObject({ ok: false, errors: ["invalid_tenant_id"] });
    expect(
      validateIdentityConnection(connection({ defaultRoleIsCustomer: true })),
    ).toMatchObject({ ok: false, errors: ["staff_role_required"] });
  });

  it("IP-14/IP-31: tolerates only the documented SCIM Entra deviations and refuses authority attributes", () => {
    expect(
      parseScimUser(scimUser({ active: "False", title: "Support" })),
    ).toEqual({
      ok: true,
      value: { userName: "person", active: false, title: "Support" },
    });
    expect(parseScimUser(scimUser({ active: "maybe" }))).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(parseScimUser(scimUser({ active: "false" }))).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(parseScimUser({})).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(parseScimUser(scimUser({ userName: "" }))).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(parseScimUser({ userName: "person" })).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(
      parseScimUser(scimUser({ workspace_id: "another-workspace" })),
    ).toEqual({ ok: false, reason: "forbidden_attribute" });
    expect(parseScimUser(scimUser({ unknown: "value" }))).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(
      parseScimUser(scimUser({ name: { givenName: "Pat", customField: "x" } })),
    ).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(
      parseScimUser(scimUser({ schemas: ["urn:attacker:custom"] })),
    ).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
    expect(
      parseScimUser(
        scimUser({
          emails: [{ value: "person@example.com", type: 42, display: {} }],
        }),
      ),
    ).toEqual({ ok: false, reason: "invalid_resource" });
    expect(
      parseScimUser(
        scimUser({ emails: [{ value: "person@example.com", type: "work" }] }),
      ),
    ).toEqual({
      ok: true,
      value: { userName: "person", email: "person@example.com" },
    });
  });

  it("IP-18/IP-32: keeps same-connection and cross-connection duplicate responses identical", () => {
    expect(scimConflictResponse("same_connection")).toEqual(
      scimConflictResponse("another_connection"),
    );
    expect(scimConflictResponse("same_connection")).toEqual({
      status: 409,
      scimType: "uniqueness",
      detail: "A matching identity already exists.",
    });
  });

  it("IP-4/IP-13/IP-17/IP-31: applies SCIM patch operations without allowing scope or authority changes", () => {
    expect(
      applyScimPatchOps({ userName: "before", active: true }, [
        { op: "Replace", path: "userName", value: "after" },
        { op: "replace", path: "active", value: "False" },
      ]),
    ).toEqual({ ok: true, value: { userName: "after", active: false } });
    expect(
      applyScimPatchOps({ userName: "person", active: true }, [
        { op: "replace", value: { active: false, title: "Support" } },
      ]),
    ).toEqual({
      ok: true,
      value: { userName: "person", active: false, title: "Support" },
    });
    expect(
      applyScimPatchOps({}, [{ op: "replace", path: "role", value: "admin" }]),
    ).toEqual({ ok: false, reason: "forbidden_attribute" });
    expect(
      applyScimPatchOps({}, [{ op: "replace", path: "unknown", value: "x" }]),
    ).toEqual({ ok: false, reason: "invalid_patch" });
    expect(
      applyScimPatchOps({ externalId: "immutable" }, [
        { op: "replace", value: { externalId: "rewritten", title: "Support" } },
      ]),
    ).toEqual({ ok: false, reason: "forbidden_attribute" });
    expect(
      applyScimPatchOps({}, [
        {
          op: "replace",
          path: `  ${" ".repeat(100_000)}active  `,
          value: true,
        },
      ]),
    ).toMatchObject({ ok: true, value: { active: true } });
    expect(validateScimPutExternalId("stable", "stable")).toEqual({
      ok: true,
      value: true,
    });
    expect(validateScimPutExternalId("stable", "changed")).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
  });

  it("security: rejects a pathless PATCH value whose prototype (not own keys) carries externalId/active", () => {
    // Object.assign copies own enumerable keys via [[Set]], so assigning a
    // parsed "__proto__" key here repoints the merged object's prototype to
    // {externalId: "HIJACK", active: false} instead of creating an own key.
    // Object.keys/Object.entries only see the merged object's own "title"
    // key, but ordinary property access (input.externalId, input.active)
    // also sees the inherited ones, so this must not slip past the guard.
    const malicious = Object.assign(
      {},
      JSON.parse(
        '{"__proto__":{"externalId":"HIJACK","active":false},"title":"t"}',
      ),
    );
    expect((malicious as { externalId?: string }).externalId).toBe("HIJACK");
    expect(Object.keys(malicious)).toEqual(["title"]);
    expect(
      applyScimPatchOps({ externalId: "original" }, [
        { op: "replace", value: malicious },
      ]),
    ).toEqual({ ok: false, reason: "invalid_patch" });
  });

  it("closes N1: PATCH name.familyName/name.givenName act on the real camelCase key, not the lowercased path", () => {
    expect(
      applyScimPatchOps(
        { userName: "person", name: { givenName: "Pat", familyName: "Doe" } },
        [{ op: "replace", path: "name.familyName", value: "Smith" }],
      ),
    ).toEqual({
      ok: true,
      value: {
        userName: "person",
        name: { givenName: "Pat", familyName: "Smith" },
      },
    });
    expect(
      applyScimPatchOps(
        { userName: "person", name: { givenName: "Pat", familyName: "Doe" } },
        [{ op: "remove", path: "name.givenName" }],
      ),
    ).toEqual({
      ok: true,
      value: { userName: "person", name: { familyName: "Doe" } },
    });
  });

  it("IP-20/IP-21: maps only existing in-scope roles within the connection's rank ceiling", () => {
    const mappings: IdentityRoleMapping[] = [
      {
        externalGroupId: "allowed",
        roleId: "member",
        roleRank: 2,
        roleScope: "agent",
        roleIsCustomer: false,
        grantsInstanceAdmin: false,
        grantsSeesAll: false,
      },
      {
        externalGroupId: "high",
        roleId: "admin",
        roleRank: 4,
        roleScope: "agent",
        roleIsCustomer: false,
        grantsInstanceAdmin: false,
        grantsSeesAll: false,
      },
      {
        externalGroupId: "authority",
        roleId: "instance-admin",
        roleRank: 1,
        roleScope: "agent",
        roleIsCustomer: false,
        grantsInstanceAdmin: true,
        grantsSeesAll: false,
      },
      {
        externalGroupId: "wrong-scope",
        roleId: "customer",
        roleRank: 1,
        roleScope: "customer",
        roleIsCustomer: true,
        grantsInstanceAdmin: false,
        grantsSeesAll: false,
      },
    ];
    expect(
      mapExternalGroupsToRoles(
        ["allowed", "high", "authority", "wrong-scope", "missing"],
        mappings,
        { portalScope: "agent", maxRoleRank: 3 },
      ),
    ).toEqual([
      {
        roleId: "member",
        roleRank: 2,
        roleScope: "agent",
        roleIsCustomer: false,
        grantsInstanceAdmin: false,
        grantsSeesAll: false,
      },
    ]);
    const malformed = [
      { ...mappings[0], externalGroupId: "nan-rank", roleRank: Number.NaN },
      {
        ...mappings[0],
        externalGroupId: "undefined-rank",
        roleRank: undefined,
      },
      {
        ...mappings[0],
        externalGroupId: "null-authority",
        grantsSeesAll: null,
      },
      {
        ...mappings[0],
        externalGroupId: "missing-authority",
        grantsInstanceAdmin: undefined,
      },
    ] as unknown as IdentityRoleMapping[];
    expect(
      mapExternalGroupsToRoles(
        malformed.map(({ externalGroupId }) => externalGroupId),
        malformed,
        { portalScope: "agent", maxRoleRank: 3 },
      ),
    ).toEqual([]);
    expect(
      mapExternalGroupsToRoles(["allowed"], mappings.slice(0, 1), {
        portalScope: "agent",
        maxRoleRank: Number.NaN,
      }),
    ).toEqual([]);
  });

  it("IP-15/IP-16/IP-30: deprovisions fully, never restores roles, and claims only locally verified placeholders", () => {
    expect(decideProvisioningTransition("deactivate", "active")).toEqual({
      kind: "deactivate",
      revokeSessions: true,
      revokeApiKeys: true,
      revokeMcpKeys: true,
      membershipPolicy: "end_memberships",
    });
    expect(
      decideProvisioningTransition("deactivate", "active", "keep_memberships"),
    ).toMatchObject({ membershipPolicy: "keep_memberships" });
    expect(decideProvisioningTransition("reactivate", "deactivated")).toEqual({
      kind: "reactivate",
      restoreRoles: false,
    });
    expect(decideProvisioningTransition("claim_sso", "placeholder")).toEqual({
      kind: "refuse",
      reason: "local_verification_required",
    });
    expect(
      decideProvisioningTransition("claim_local_verified", "placeholder"),
    ).toEqual({ kind: "claim_placeholder", audit: true });
  });
});

describe("P3 customer portal reach", () => {
  const person = { personId: "person-a", organisationId: "org-a" };

  it("CP-1/CP-2: never reaches another customer organisation's resource", () => {
    expect(
      canReachCustomerPortalResource(person, {
        organisationId: "org-b",
        customerVisibility: "organisation",
        requesterPersonId: "person-b",
        participantPersonIds: ["person-a"],
      }),
    ).toBe(false);
  });

  it("CP-16: limits private resources to the requester and explicit participants", () => {
    const resource = {
      organisationId: "org-a",
      customerVisibility: "private" as const,
      requesterPersonId: "person-b",
      participantPersonIds: ["person-c"],
    };
    expect(canReachCustomerPortalResource(person, resource)).toBe(false);
    expect(
      canReachCustomerPortalResource(
        { ...person, personId: "person-b" },
        resource,
      ),
    ).toBe(true);
    expect(
      canReachCustomerPortalResource(
        { ...person, personId: "person-c" },
        resource,
      ),
    ).toBe(true);
  });

  it("CP-16: allows organisation-visible resources to colleagues in that organisation", () => {
    expect(
      canReachCustomerPortalResource(person, {
        organisationId: "org-a",
        customerVisibility: "organisation",
        requesterPersonId: "person-b",
        participantPersonIds: [],
      }),
    ).toBe(true);
  });
});
