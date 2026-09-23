import { describe, expect, it } from "vitest";
import {
  applyScimPatchOps,
  decideProvisioningTransition,
  mapExternalGroupsToRoles,
  normaliseEntraClaims,
  parseScimUser,
  scimConflictResponse,
  validateIdentityConnection,
} from "./identity.js";
import { canReachCustomerPortalResource } from "./portal.js";
import type {
  IdentityConnectionDraft,
  IdentityRoleMapping,
  VerifiedEntraClaims,
} from "./types.js";

const TENANT_ID = "12345678-1234-1234-1234-123456789012";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

function connection(
  overrides: Partial<IdentityConnectionDraft> = {},
): IdentityConnectionDraft {
  return {
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

function claims(
  overrides: Partial<VerifiedEntraClaims> = {},
): VerifiedEntraClaims {
  return {
    iss: ISSUER,
    tid: TENANT_ID,
    oid: "person-object-id",
    preferred_username: " User@Example.com ",
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
      normaliseEntraClaims(
        claims({ email: "first@example.com" }),
        connection(),
      ),
    ).toEqual({
      ok: true,
      identity: {
        subject: { oid: "person-object-id", tid: TENANT_ID },
        address: "first@example.com",
        addressUsed: "email",
        groupObjectIds: [],
      },
    });
    expect(
      normaliseEntraClaims(claims({ tid: "another-tenant" }), connection()),
    ).toEqual({ ok: false, reason: "tenant_mismatch" });
    expect(
      normaliseEntraClaims(
        claims({ iss: "https://login.microsoftonline.com/common/v2.0" }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "issuer_mismatch" });
  });

  it("IP-9/IP-27: falls back through usable addresses and fails closed without one", () => {
    expect(
      normaliseEntraClaims(
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
      normaliseEntraClaims(
        claims({ preferred_username: "not-an-email", upn: "also invalid" }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "no_usable_address" });
    expect(
      normaliseEntraClaims(
        claims({ email: "person@example.com", email_verified: false }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "unverified_address" });
  });

  it("IP-28: accepts group object ids and ignores overage claims without a Graph lookup", () => {
    expect(
      normaliseEntraClaims(
        claims({ groups: ["group-a", "group-a", "group-b"] }),
        connection(),
      ),
    ).toMatchObject({
      ok: true,
      identity: { groupObjectIds: ["group-a", "group-b"] },
    });
    expect(
      normaliseEntraClaims(
        claims({ groups: ["ignored"], _claim_names: { groups: "src1" } }),
        connection(),
      ),
    ).toMatchObject({
      ok: true,
      identity: { groupObjectIds: "overage" },
    });
    expect(
      normaliseEntraClaims(claims({ groups: "display-name" }), connection()),
    ).toEqual({ ok: false, reason: "invalid_groups" });
    expect(
      normaliseEntraClaims(
        claims({ _claim_names: { groups: null } }),
        connection(),
      ),
    ).toEqual({ ok: false, reason: "invalid_groups" });
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
