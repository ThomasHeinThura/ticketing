import { createRequire } from "node:module";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalScimAdminBody,
  sha256,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

const ADMIN_ID = "scim-admin-route-admin";
const CONNECTION_ID = "scim-admin-route-connection";
const PASSWORD = "scim-admin-route-password";
const ENCRYPTION_KEY = "ab".repeat(32);
const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;
const originalPreviousEncryptionKey =
  process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalEncryptionKey;
  if (originalPreviousEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  else
    process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS =
      originalPreviousEncryptionKey;
});

describe("SCIM administration API", () => {
  it("authenticates the delegated discovery mount with only its enabled connection bearer", async () => {
    const token = "A".repeat(43);
    await db.insert(schema.identityConnectionTable).values({
      id: CONNECTION_ID,
      providerType: "entra",
      portalScope: "agent",
      organisationId: null,
      displayName: "SCIM protocol fixture",
      issuer: "https://login.microsoftonline.com/tenant/v2.0",
      tenantId: "tenant",
      clientId: "client",
      clientSecret: encryptIdentityClientSecret(CONNECTION_ID, "fixture"),
      redirectUri: "http://localhost:1337/api/identity/callback",
      scopes: ["openid"],
      claimMapping: {},
      domainBindings: [],
      jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
      maxRoleRank: 10,
      enabled: true,
    });
    await db.insert(schema.scimConnectionTable).values({
      identityConnectionId: CONNECTION_ID,
      tokenHash: sha256(token),
      tokenPrefix: token.slice(0, 8),
      tokenCreatedAt: new Date(),
      allowedResources: ["users", "groups"],
      enabled: true,
    });

    const { app } = createApp();
    const response = await app.request("/scim/v2/ServiceProviderConfig", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({
      patch: { supported: true },
      bulk: { supported: false },
      authenticationSchemes: [{ type: "oauthbearertoken" }],
    });

    const portalProbe = await app.request(
      new Request(
        "http://portal.localhost:5174/scim/v2/ServiceProviderConfig",
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    expect(portalProbe.status).toBe(404);
    expect(portalProbe.headers.get("set-cookie")).toBeNull();

    const internalOrganisation = await ensureInternalOrganisation();
    for (const [index, userName] of [
      "alpha@example.test",
      "beta@example.test",
      "gamma@example.test",
    ].entries()) {
      const personId = `scim-protocol-person-${index + 1}`;
      await db.insert(schema.personTable).values({
        id: personId,
        organisationId: internalOrganisation.id,
        side: "staff",
        displayName: index === 0 ? "Alpha Staff" : null,
        isPlaceholder: true,
      });
      await db.insert(schema.externalIdentityTable).values({
        id: `scim-protocol-identity-${index + 1}`,
        identityConnectionId: CONNECTION_ID,
        personId,
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        subject: `scim-subject-${index + 1}`,
        scimExternalId: `external-${index + 1}`,
        userNameSnapshot: userName,
        emailSnapshot: userName,
        provisionedVia: "scim",
        active: true,
      });
    }

    const listed = await app.request("/scim/v2/Users?startIndex=1&count=25", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await listed.json()).toMatchObject({
      totalResults: 3,
      startIndex: 1,
      itemsPerPage: 3,
      Resources: [
        {
          externalId: "external-1",
          userName: "alpha@example.test",
          displayName: "Alpha Staff",
          name: { formatted: "Alpha Staff" },
        },
        { externalId: "external-2", userName: "beta@example.test" },
        { externalId: "external-3", userName: "gamma@example.test" },
      ],
    });

    const pageTwo = await app.request("/scim/v2/Users?startIndex=2&count=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pageTwo.status).toBe(200);
    expect(await pageTwo.json()).toMatchObject({
      totalResults: 3,
      startIndex: 2,
      itemsPerPage: 1,
      Resources: [{ externalId: "external-2" }],
    });

    const filtered = await app.request(
      `/scim/v2/Users?filter=${encodeURIComponent('externalId eq "external-2"')}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toMatchObject({
      totalResults: 1,
      Resources: [{ externalId: "external-2" }],
    });

    const provisioned = await app.request("/scim/v2/Users", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "created-external",
        userName: "created@example.test",
        displayName: "Created Person",
        emails: [{ value: "created@example.test", primary: true }],
      }),
    });
    expect(provisioned.status).toBe(201);
    const provisionedResource = (await provisioned.json()) as {
      id: string;
      displayName: string;
    };
    expect(provisionedResource.displayName).toBe("Created Person");

    const groupCreate = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "support-team",
        displayName: "Support team",
        members: [{ value: provisionedResource.id, type: "User" }],
      }),
    });
    expect(groupCreate.status).toBe(201);
    const groupResource = (await groupCreate.json()) as {
      id: string;
      members: Array<{ value: string }>;
    };
    expect(groupResource.members).toEqual([
      {
        value: provisionedResource.id,
        type: "User",
        display: "Created Person",
      },
    ]);
    const duplicateGroup = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "support-team",
        displayName: "Support team",
        members: [],
      }),
    });
    expect(duplicateGroup.status).toBe(409);
    expect(await duplicateGroup.json()).not.toHaveProperty("id");

    await db.insert(schema.identityConnectionTable).values({
      id: "scim-protocol-foreign-connection",
      providerType: "entra",
      portalScope: "agent",
      organisationId: null,
      displayName: "Foreign SCIM connection",
      issuer: "https://identity.example.test/foreign",
      tenantId: "foreign-tenant",
      clientId: "foreign-client",
      clientSecret: encryptIdentityClientSecret(
        "scim-protocol-foreign-connection",
        "fixture",
      ),
      redirectUri: "http://localhost:1337/api/identity/callback",
      scopes: ["openid"],
      claimMapping: {},
      domainBindings: [],
      jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
      maxRoleRank: 10,
      enabled: true,
    });
    await db.insert(schema.externalIdentityTable).values({
      id: "scim-protocol-foreign-identity",
      identityConnectionId: "scim-protocol-foreign-connection",
      personId: "scim-protocol-person-2",
      issuer: "https://identity.example.test/foreign",
      subject: "foreign-subject",
      scimExternalId: "foreign-external",
      userNameSnapshot: "foreign@example.test",
      emailSnapshot: "foreign@example.test",
      provisionedVia: "scim",
      active: true,
    });
    const foreignMember = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "foreign-member-group",
        displayName: "Foreign member group",
        members: [{ value: "scim-protocol-foreign-identity", type: "User" }],
      }),
    });
    expect(foreignMember.status).toBe(400);
    const [rejectedGroup] = await db
      .select({ id: schema.scimGroupTable.id })
      .from(schema.scimGroupTable)
      .where(eq(schema.scimGroupTable.externalId, "foreign-member-group"));
    expect(rejectedGroup).toBeUndefined();
    const [unmappedGrant] = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(unmappedGrant).toBeUndefined();

    const internalOrg = await ensureInternalOrganisation();
    const [workspace] = await db
      .insert(schema.workspaceTable)
      .values({
        id: "scim-protocol-group-workspace",
        organisationId: internalOrg.id,
        name: "SCIM group workspace",
        slug: "scim-protocol-group-workspace",
        createdAt: new Date(),
      })
      .returning({ id: schema.workspaceTable.id });
    if (!workspace) throw new Error("SCIM test workspace was not created");
    await db.insert(schema.roleTable).values({
      id: "scim-protocol-group-role",
      scope: "workspace",
      workspaceId: workspace.id,
      key: "scim-protocol-group-role",
      name: "SCIM group role",
      rank: 2,
      capabilities: [],
    });
    await db.insert(schema.scimGroupMappingTable).values({
      id: "scim-protocol-group-mapping",
      scimConnectionId: CONNECTION_ID,
      externalGroupId: "support-team",
      roleId: "scim-protocol-group-role",
      scope: "workspace",
      scopeId: workspace.id,
    });
    const reconciled = await app.request(
      `/scim/v2/Groups/${groupResource.id}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          externalId: "support-team",
          displayName: "Support team",
          members: [{ value: provisionedResource.id, type: "User" }],
        }),
      },
    );
    expect(reconciled.status).toBe(200);
    const [activeGroupGrant] = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(activeGroupGrant).toBeDefined();

    const removedMember = await app.request(
      `/scim/v2/Groups/${groupResource.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "remove",
              path: `members[value eq "${provisionedResource.id}"]`,
            },
          ],
        }),
      },
    );
    expect(removedMember.status).toBe(200);
    expect((await removedMember.json()).members).toEqual([]);
    const [retiredGroupGrant] = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(retiredGroupGrant).toBeUndefined();
    const [retainedGroupHistory] = await db
      .select({ revokedAt: schema.scimGroupMemberTable.revokedAt })
      .from(schema.scimGroupMemberTable)
      .where(
        eq(
          schema.scimGroupMemberTable.externalIdentityId,
          provisionedResource.id,
        ),
      );
    expect(retainedGroupHistory?.revokedAt).toBeInstanceOf(Date);

    await db.insert(schema.userTable).values({
      id: "scim-protocol-linked-user",
      name: "Created Person Account",
      email: "created@example.test",
      role: null,
    });
    const [createdIdentity] = await db
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, provisionedResource.id));
    if (!createdIdentity) throw new Error("SCIM identity was not persisted");
    await db
      .update(schema.personTable)
      .set({ userId: "scim-protocol-linked-user" })
      .where(eq(schema.personTable.id, createdIdentity.personId));
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: "scim-protocol-linked-session",
      token: "scim-protocol-linked-session-token",
      userId: "scim-protocol-linked-user",
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apikeyTable).values({
      id: "scim-protocol-linked-key",
      referenceId: "scim-protocol-linked-user",
      userId: "scim-protocol-linked-user",
      key: "scim-protocol-linked-api-key",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.membershipGrantTable).values({
      id: "scim-protocol-linked-direct-grant",
      personId: createdIdentity.personId,
      scope: "workspace",
      scopeId: workspace.id,
      roleId: "scim-protocol-group-role",
      sourceKind: "direct",
      directOrigin: "admin",
      grantedByPersonId: createdIdentity.personId,
      seesAll: false,
    });

    const restoreMembership = await app.request(
      `/scim/v2/Groups/${groupResource.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "add",
              path: "members",
              value: [{ value: provisionedResource.id, type: "User" }],
            },
          ],
        }),
      },
    );
    expect(restoreMembership.status).toBe(200);

    const replaced = await app.request(
      `/scim/v2/Users/${provisionedResource.id}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          externalId: "created-external",
          userName: "created@example.test",
          displayName: "Created Person Updated",
          emails: [{ value: "created@example.test", primary: true }],
        }),
      },
    );
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      displayName: "Created Person Updated",
    });

    const patched = await app.request(
      `/scim/v2/Users/${provisionedResource.id}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "title", value: "Support" }],
        }),
      },
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: "Support" });

    const deactivated = await app.request(
      `/scim/v2/Users/${provisionedResource.id}`,
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    );
    expect(deactivated.status).toBe(204);
    const deactivatedRow = await db
      .select({ active: schema.personTable.active })
      .from(schema.externalIdentityTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.externalIdentityTable.personId),
      )
      .where(eq(schema.externalIdentityTable.id, provisionedResource.id));
    expect(deactivatedRow).toEqual([{ active: false }]);
    const [revokedSession] = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, "scim-protocol-linked-session"));
    expect(revokedSession).toBeUndefined();
    const [disabledApiKey] = await db
      .select({ enabled: schema.apikeyTable.enabled })
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, "scim-protocol-linked-key"));
    expect(disabledApiKey?.enabled).toBe(false);
    const remainingExternalGrants = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(remainingExternalGrants).toEqual([]);
    const [retiredDirectGrant] = await db
      .select({
        revokedAt: schema.membershipGrantTable.revokedAt,
        reason: schema.membershipGrantTable.revocationReason,
      })
      .from(schema.membershipGrantTable)
      .where(
        eq(schema.membershipGrantTable.id, "scim-protocol-linked-direct-grant"),
      );
    expect(retiredDirectGrant).toEqual({
      revokedAt: expect.any(Date),
      reason: "direct_removed",
    });

    const reactivated = await app.request(
      `/scim/v2/Users/${provisionedResource.id}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          externalId: "created-external",
          userName: "created@example.test",
          displayName: "Created Person Updated",
          emails: [{ value: "created@example.test", primary: true }],
          active: true,
        }),
      },
    );
    expect(reactivated.status).toBe(200);
    expect(await reactivated.json()).toMatchObject({ active: true });
    const [stillNoGrant] = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(stillNoGrant).toBeUndefined();
    const resynced = await app.request(`/scim/v2/Groups/${groupResource.id}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "support-team",
        displayName: "Support team",
        members: [{ value: provisionedResource.id, type: "User" }],
      }),
    });
    expect(resynced.status).toBe(200);
    const [resyncedGrant] = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(resyncedGrant).toBeDefined();
    const deletedGroup = await app.request(
      `/scim/v2/Groups/${groupResource.id}`,
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    );
    expect(deletedGroup.status).toBe(204);
    const [softDeletedGroup] = await db
      .select({ active: schema.scimGroupTable.active })
      .from(schema.scimGroupTable)
      .where(eq(schema.scimGroupTable.id, groupResource.id));
    expect(softDeletedGroup?.active).toBe(false);
    const [removedDirectoryMembership] = await db
      .select({ active: schema.scimGroupDirectoryMemberTable.active })
      .from(schema.scimGroupDirectoryMemberTable)
      .where(
        and(
          eq(
            schema.scimGroupDirectoryMemberTable.scimGroupId,
            groupResource.id,
          ),
          eq(
            schema.scimGroupDirectoryMemberTable.externalIdentityId,
            provisionedResource.id,
          ),
        ),
      );
    expect(removedDirectoryMembership?.active).toBe(false);

    const invalidFilter = await app.request(
      `/scim/v2/Users?filter=${encodeURIComponent('groups eq "staff"')}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(invalidFilter.status).toBe(400);
    expect(await invalidFilter.json()).toMatchObject({
      scimType: "invalidFilter",
    });
    const missingUser = await app.request("/scim/v2/Users/foreign-user", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missingUser.status).toBe(404);

    const denied = await app.request("/scim/v2/ServiceProviderConfig", {
      headers: { authorization: `Bearer ${"B".repeat(43)}` },
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("set-cookie")).toBeNull();

    const cookieOnly = await app.request("/scim/v2/ServiceProviderConfig", {
      headers: { cookie: "__Host-tdk_agent_session=unrelated-session" },
    });
    expect(cookieOnly.status).toBe(401);

    await db
      .update(schema.scimConnectionTable)
      .set({ enabled: false })
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );
    const disabledScim = await app.request("/scim/v2/ServiceProviderConfig", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(disabledScim.status).toBe(401);

    await db
      .update(schema.scimConnectionTable)
      .set({ enabled: true })
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );
    await db
      .update(schema.identityConnectionTable)
      .set({ enabled: false })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    const disabledConnection = await app.request(
      "/scim/v2/ServiceProviderConfig",
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(disabledConnection.status).toBe(401);
  });

  it("returns safe settings and atomically consumes operation proof on a CAS mutation", async () => {
    const now = new Date();
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: ADMIN_ID,
        name: "SCIM Administrator",
        email: "scim-admin-route@example.test",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("test administrator was not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await db.insert(schema.sessionTable).values({
      id: `session-${admin.id}`,
      token: `token-${admin.id}`,
      userId: admin.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.accountTable).values({
      id: `account-${admin.id}`,
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash(PASSWORD, 4),
    });
    const [person] = await db
      .select({
        id: schema.personTable.id,
        organisationId: schema.personTable.organisationId,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.id));
    if (!person) throw new Error("test administrator person was not created");
    await db.insert(schema.identityConnectionTable).values({
      id: CONNECTION_ID,
      providerType: "entra",
      portalScope: "agent",
      organisationId: null,
      displayName: "Test identity connection",
      issuer:
        "https://login.microsoftonline.com/12345678-1234-1234-1234-123456789012/v2.0",
      tenantId: "12345678-1234-1234-1234-123456789012",
      clientId: "test-client-id",
      clientSecret: encryptIdentityClientSecret(
        CONNECTION_ID,
        "test-client-secret",
      ),
      redirectUri: "http://localhost:1337/api/identity/callback",
      scopes: ["openid", "profile", "email"],
      claimMapping: {},
      domainBindings: [],
      jitPolicy: { enabled: false, requiredEntraAppRole: "test-role" },
      maxRoleRank: 10,
      enabled: false,
      createdBy: person.id,
      updatedBy: person.id,
    });
    await db.insert(schema.scimConnectionTable).values({
      identityConnectionId: CONNECTION_ID,
      allowedResources: ["users", "groups"],
      lifecyclePolicy: "end_memberships",
      enabled: false,
    });

    const { app } = createApp();
    const sessionCookie = `__Host-tdk_agent_session=token-${admin.id}`;
    const read = await app.request(
      `/api/instance/identity-connections/${CONNECTION_ID}/scim`,
    );
    expect(read.status).toBe(200);
    const safeSettings = (await read.json()) as {
      configVersion: number;
      data: Record<string, unknown>;
    };
    expect(safeSettings.configVersion).toBe(1);
    expect(safeSettings.data).toMatchObject({
      enabled: false,
      allowedResources: ["users", "groups"],
      lifecyclePolicy: "end_memberships",
      mappings: [],
    });
    expect(JSON.stringify(safeSettings)).not.toContain("clientSecret");
    expect(JSON.stringify(safeSettings)).not.toContain("test-client-secret");
    expect(JSON.stringify(safeSettings)).not.toContain("tokenPrefix");
    expect(JSON.stringify(safeSettings)).not.toContain("tokenHash");

    const request = {
      configVersion: 1,
      kind: "settings",
      lifecyclePolicy: "keep_memberships",
    } as const;
    const challengeResponse = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "scim_admin_update",
          connectionId: CONNECTION_ID,
          request,
        }),
      },
      sessionCookie,
    );
    expect(challengeResponse.status).toBe(200);
    const challenge = (await challengeResponse.json()) as {
      challengeId: string;
      nonce: string;
    };
    const proofResponse = await csrfRequest(
      app,
      "/api/me/step-up",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "scim_admin_update",
          connectionId: CONNECTION_ID,
          request,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method: "password",
          password: PASSWORD,
        }),
      },
      sessionCookie,
    );
    expect(proofResponse.status).toBe(200);
    const proof = (await proofResponse.json()) as { token: string };
    const canonicalBody = canonicalScimAdminBody(CONNECTION_ID, {
      configVersion: 1,
      kind: "settings",
      lifecyclePolicy: "keep_memberships",
    });
    expect(canonicalBody.toString("utf8")).not.toContain(PASSWORD);

    const patch = () =>
      csrfRequest(
        app,
        `/api/instance/identity-connections/${CONNECTION_ID}/scim`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-taskdesk-step-up-token": proof.token,
          },
          body: JSON.stringify(request),
        },
        sessionCookie,
      );
    const updated = await patch();
    expect(updated.status).toBe(200);
    const updatedSettings = (await updated.json()) as {
      configVersion: number;
      data: { lifecyclePolicy: string };
    };
    expect(updatedSettings.configVersion).toBe(2);
    expect(updatedSettings.data.lifecyclePolicy).toBe("keep_memberships");
    expect(JSON.stringify(updatedSettings)).not.toContain(proof.token);

    const replay = await patch();
    // The stale CAS is reported before proof consumption; it must leave every
    // mutation unchanged. Restore the fixture version to exercise one-use proof
    // rejection independently of the version precondition.
    expect(replay.status).toBe(409);
    const [stored] = await db
      .select({ version: schema.identityConnectionTable.configVersion })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(stored?.version).toBe(2);
    await db
      .update(schema.identityConnectionTable)
      .set({ configVersion: 1 })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    await db
      .update(schema.scimConnectionTable)
      .set({ lifecyclePolicy: "end_memberships" })
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );
    const consumedProofReplay = await patch();
    expect(consumedProofReplay.status).toBe(403);
    const [event] = await db
      .select({ kind: schema.provisioningEventTable.kind })
      .from(schema.provisioningEventTable)
      .where(
        eq(schema.provisioningEventTable.identityConnectionId, CONNECTION_ID),
      );
    expect(event?.kind).toBe("connection.changed");

    const operationToken = async (
      operation: "scim_token_rotate" | "scim_token_revoke",
      version: number,
    ) => {
      const challengeResponse = await csrfRequest(
        app,
        "/api/me/step-up/challenges",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "operation",
            operation,
            connectionId: CONNECTION_ID,
            version,
          }),
        },
        sessionCookie,
      );
      expect(challengeResponse.status).toBe(200);
      const challenge = (await challengeResponse.json()) as {
        challengeId: string;
        nonce: string;
      };
      const proveResponse = await csrfRequest(
        app,
        "/api/me/step-up",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "operation",
            operation,
            connectionId: CONNECTION_ID,
            version,
            challengeId: challenge.challengeId,
            nonce: challenge.nonce,
            method: "password",
            password: PASSWORD,
          }),
        },
        sessionCookie,
      );
      expect(proveResponse.status).toBe(200);
      return (await proveResponse.json()) as { token: string };
    };

    const rotationProof = await operationToken("scim_token_rotate", 1);
    const staleRotation = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/scim/rotate-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": rotationProof.token,
        },
        body: JSON.stringify({ version: 2 }),
      },
      sessionCookie,
    );
    expect(staleRotation.status).toBe(409);
    const [beforeRotation] = await db
      .select({ version: schema.identityConnectionTable.configVersion })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(beforeRotation?.version).toBe(1);
    const rotated = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/scim/rotate-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": rotationProof.token,
        },
        body: JSON.stringify({ version: 1 }),
      },
      sessionCookie,
    );
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as {
      configVersion: number;
      token: string;
      tokenRotatedAt: string;
    };
    expect(rotatedBody.configVersion).toBe(2);
    expect(rotatedBody.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Number.isNaN(Date.parse(rotatedBody.tokenRotatedAt))).toBe(false);
    const [rotatedState] = await db
      .select({
        tokenHash: schema.scimConnectionTable.tokenHash,
        tokenPrefix: schema.scimConnectionTable.tokenPrefix,
        enabled: schema.scimConnectionTable.enabled,
      })
      .from(schema.scimConnectionTable)
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );
    expect(rotatedState?.tokenHash).toEqual(sha256(rotatedBody.token));
    expect(rotatedState?.tokenPrefix).toBe(rotatedBody.token.slice(0, 8));
    expect(rotatedState?.enabled).toBe(false);
    expect(JSON.stringify(rotatedState)).not.toContain(rotatedBody.token);
    const settingsAfterRotation = await app.request(
      `/api/instance/identity-connections/${CONNECTION_ID}/scim`,
    );
    const safeRotatedSettings = await settingsAfterRotation.text();
    expect(settingsAfterRotation.status).toBe(200);
    expect(safeRotatedSettings).not.toContain(rotatedBody.token);
    expect(safeRotatedSettings).not.toContain("tokenHash");
    expect(safeRotatedSettings).not.toContain("tokenPrefix");
    const replayedRotation = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/scim/rotate-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": rotationProof.token,
        },
        body: JSON.stringify({ version: 2 }),
      },
      sessionCookie,
    );
    expect(replayedRotation.status).toBe(403);
    const [afterRotationReplay] = await db
      .select({
        version: schema.identityConnectionTable.configVersion,
        tokenHash: schema.scimConnectionTable.tokenHash,
      })
      .from(schema.identityConnectionTable)
      .innerJoin(
        schema.scimConnectionTable,
        eq(
          schema.scimConnectionTable.identityConnectionId,
          schema.identityConnectionTable.id,
        ),
      )
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(afterRotationReplay?.version).toBe(2);
    expect(afterRotationReplay?.tokenHash).toEqual(sha256(rotatedBody.token));

    const revokeProof = await operationToken("scim_token_revoke", 2);
    const crossOperation = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/scim/rotate-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": revokeProof.token,
        },
        body: JSON.stringify({ version: 2 }),
      },
      sessionCookie,
    );
    expect(crossOperation.status).toBe(403);
    const [beforeRevoke] = await db
      .select({ version: schema.identityConnectionTable.configVersion })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    expect(beforeRevoke?.version).toBe(2);
    const revoked = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/scim/revoke-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": revokeProof.token,
        },
        body: JSON.stringify({ version: 2 }),
      },
      sessionCookie,
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ configVersion: 3, revoked: true });
    const [revokedState] = await db
      .select({
        tokenHash: schema.scimConnectionTable.tokenHash,
        tokenPrefix: schema.scimConnectionTable.tokenPrefix,
        enabled: schema.scimConnectionTable.enabled,
      })
      .from(schema.scimConnectionTable)
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );
    expect(revokedState).toEqual({
      tokenHash: null,
      tokenPrefix: null,
      enabled: false,
    });
    const [workspace] = await db
      .insert(schema.workspaceTable)
      .values({
        id: "scim-projection-workspace",
        organisationId: person.organisationId,
        name: "Projection fixture",
        slug: "scim-projection-fixture",
        createdAt: now,
      })
      .returning({ id: schema.workspaceTable.id });
    if (!workspace) throw new Error("test workspace was not created");
    await db.insert(schema.roleTable).values([
      {
        id: "scim-projection-direct-role",
        scope: "workspace",
        workspaceId: workspace.id,
        key: "projection-direct",
        name: "Projection direct",
        rank: 1,
        capabilities: [],
      },
      {
        id: "scim-projection-group-role",
        scope: "workspace",
        workspaceId: workspace.id,
        key: "projection-group",
        name: "Projection group",
        rank: 5,
        capabilities: [],
      },
    ]);
    const [membership] = await db
      .insert(schema.membershipTable)
      .values({
        id: "scim-projection-membership",
        personId: person.id,
        scope: "workspace",
        scopeId: workspace.id,
        roleId: "scim-projection-direct-role",
        seesAll: false,
      })
      .returning({ id: schema.membershipTable.id });
    if (!membership) throw new Error("test membership was not created");
    await db.insert(schema.externalIdentityTable).values({
      id: "scim-projection-external-identity",
      identityConnectionId: CONNECTION_ID,
      personId: person.id,
      userId: admin.id,
      issuer: "https://identity.example.test",
      subject: "scim-projection-subject",
      provisionedVia: "scim",
    });
    await db.insert(schema.scimGroupMappingTable).values({
      id: "scim-projection-group-mapping",
      scimConnectionId: CONNECTION_ID,
      externalGroupId: "scim-projection-group",
      roleId: "scim-projection-group-role",
      scope: "workspace",
      scopeId: workspace.id,
    });
    await db.insert(schema.membershipGrantTable).values([
      {
        id: "scim-projection-direct-grant",
        membershipId: membership.id,
        personId: person.id,
        scope: "workspace",
        scopeId: workspace.id,
        roleId: "scim-projection-direct-role",
        sourceKind: "direct",
        directOrigin: "admin",
        grantedByPersonId: person.id,
      },
      {
        id: "scim-projection-group-grant",
        membershipId: membership.id,
        personId: person.id,
        scope: "workspace",
        scopeId: workspace.id,
        roleId: "scim-projection-group-role",
        sourceKind: "scim_group",
        externalIdentityId: "scim-projection-external-identity",
        identityConnectionId: CONNECTION_ID,
        scimGroupMappingId: "scim-projection-group-mapping",
      },
    ]);
    await db.insert(schema.scimGroupMemberTable).values({
      id: "scim-projection-group-member",
      scimGroupMappingId: "scim-projection-group-mapping",
      externalIdentityId: "scim-projection-external-identity",
      membershipId: membership.id,
      membershipGrantId: "scim-projection-group-grant",
    });
    await db
      .update(schema.scimConnectionTable)
      .set({
        enabled: true,
        tokenHash: Buffer.alloc(32, 7),
        tokenPrefix: "fixture",
      })
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );

    const disableRequest = {
      configVersion: 3,
      kind: "settings",
      enabled: false,
    } as const;
    const disableChallenge = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "scim_admin_update",
          connectionId: CONNECTION_ID,
          request: disableRequest,
        }),
      },
      sessionCookie,
    );
    expect(disableChallenge.status).toBe(200);
    const disableChallengeBody = (await disableChallenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const disableProof = await csrfRequest(
      app,
      "/api/me/step-up",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "scim_admin_update",
          connectionId: CONNECTION_ID,
          request: disableRequest,
          challengeId: disableChallengeBody.challengeId,
          nonce: disableChallengeBody.nonce,
          method: "password",
          password: PASSWORD,
        }),
      },
      sessionCookie,
    );
    expect(disableProof.status).toBe(200);
    const disableProofBody = (await disableProof.json()) as { token: string };
    const disableResponse = await csrfRequest(
      app,
      `/api/instance/identity-connections/${CONNECTION_ID}/scim`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": disableProofBody.token,
        },
        body: JSON.stringify(disableRequest),
      },
      sessionCookie,
    );
    expect(disableResponse.status).toBe(200);
    const [projectedMembership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.id, membership.id));
    expect(projectedMembership?.roleId).toBe("scim-projection-direct-role");
    const [retiredGroupGrant] = await db
      .select({
        revokedAt: schema.membershipGrantTable.revokedAt,
        revocationReason: schema.membershipGrantTable.revocationReason,
        membershipId: schema.membershipGrantTable.membershipId,
      })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.id, "scim-projection-group-grant"));
    expect(retiredGroupGrant?.revokedAt).toBeInstanceOf(Date);
    expect(retiredGroupGrant?.revocationReason).toBe("connection_disabled");
    expect(retiredGroupGrant?.membershipId).toBeNull();
    const [retiredGroupMember] = await db
      .select({
        revokedAt: schema.scimGroupMemberTable.revokedAt,
        membershipId: schema.scimGroupMemberTable.membershipId,
      })
      .from(schema.scimGroupMemberTable)
      .where(
        eq(schema.scimGroupMemberTable.id, "scim-projection-group-member"),
      );
    expect(retiredGroupMember?.revokedAt).toBeInstanceOf(Date);
    expect(retiredGroupMember?.membershipId).toBeNull();
  });
});
