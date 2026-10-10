import { createRequire } from "node:module";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalScimAdminBody,
  sha256,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { transitionPersonLifecycleInTransaction } from "../../apps/api/src/identity/person-lifecycle";
import {
  lockAndVerifyScimMutation,
  resolveScimBearer,
} from "../../apps/api/src/identity/scim-authentication";
import { setScimIdentityActive } from "../../apps/api/src/identity/scim-lifecycle";
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

async function createScimProtocolFixture(
  connectionId = "scim-protocol-isolated-connection",
  token = "F".repeat(43),
) {
  await ensureInternalOrganisation();
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: "SCIM isolated protocol fixture",
    issuer: "https://login.microsoftonline.com/tenant/v2.0",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: encryptIdentityClientSecret(connectionId, "fixture"),
    redirectUri: "http://localhost:1337/api/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
    maxRoleRank: 10,
    enabled: true,
  });
  await db.insert(schema.scimConnectionTable).values({
    identityConnectionId: connectionId,
    tokenHash: sha256(token),
    tokenPrefix: token.slice(0, 8),
    tokenCreatedAt: new Date(),
    allowedResources: ["users", "groups"],
    enabled: true,
  });
  return { app: createApp().app, connectionId, token };
}

async function createScimProtocolUser(
  app: ReturnType<typeof createApp>["app"],
  token: string,
  user = {
    externalId: "isolated-user",
    userName: "isolated@example.test",
    displayName: "Isolated User",
    email: "isolated@example.test",
    title: undefined as string | undefined,
    preferredLanguage: undefined as string | undefined,
  },
) {
  const response = await app.request("/scim/v2/Users", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/scim+json",
    },
    body: JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: user.externalId,
      userName: user.userName,
      displayName: user.displayName,
      emails: [{ value: user.email, primary: true }],
      ...(user.title ? { title: user.title } : {}),
      ...(user.preferredLanguage
        ? { preferredLanguage: user.preferredLanguage }
        : {}),
    }),
  });
  if (response.status !== 201)
    throw new Error("SCIM protocol fixture user creation failed");
  return (await response.json()) as { id: string };
}

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
  it("rechecks the resolved SCIM credential under the connection lock", async () => {
    const { connectionId, token } = await createScimProtocolFixture(
      "scim-token-recheck-connection",
      "R".repeat(43),
    );
    const authority = await resolveScimBearer(`Bearer ${token}`);
    await db.transaction(async (tx) => {
      const locked = await lockAndVerifyScimMutation(tx, authority, "users");
      expect(locked.connection.enabled).toBe(true);
      expect(locked.scim.enabled).toBe(true);
    });

    // An administrator rotates the token after the request resolved its bearer but
    // before the write takes the row locks.
    await db
      .update(schema.scimConnectionTable)
      .set({ tokenHash: sha256("S".repeat(43)) })
      .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId));
    await expect(
      db.transaction((tx) => lockAndVerifyScimMutation(tx, authority, "users")),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("IP-15/IP-16 keep-memberships leaves direct grants dormant and reprojects on reactivation", async () => {
    const { app, token, connectionId } = await createScimProtocolFixture(
      "person-lifecycle-keep-connection",
      "R".repeat(43),
    );
    const source = await createScimProtocolUser(app, token, {
      externalId: "person-lifecycle-keep-source",
      userName: "keep-lifecycle@example.test",
      displayName: "Keep Lifecycle Person",
      email: "keep-lifecycle@example.test",
      title: undefined,
      preferredLanguage: undefined,
    });
    const [identity] = await db
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, source.id));
    if (!identity) throw new Error("Lifecycle identity was not persisted");
    const internalOrg = await ensureInternalOrganisation();
    const [workspace] = await db
      .insert(schema.workspaceTable)
      .values([
        {
          id: "person-lifecycle-keep-workspace",
          organisationId: internalOrg.id,
          name: "Keep lifecycle workspace",
          slug: "person-lifecycle-keep-workspace",
          createdAt: new Date(),
        },
      ])
      .returning({ id: schema.workspaceTable.id });
    if (!workspace) throw new Error("Lifecycle workspace was not created");
    await db.insert(schema.roleTable).values({
      id: "person-lifecycle-keep-role",
      scope: "workspace",
      workspaceId: workspace.id,
      key: "person-lifecycle-keep-role",
      name: "Keep lifecycle role",
      rank: 1,
      capabilities: [],
    });
    await db.insert(schema.membershipGrantTable).values({
      id: "person-lifecycle-keep-direct-grant",
      personId: identity.personId,
      scope: "workspace",
      scopeId: workspace.id,
      roleId: "person-lifecycle-keep-role",
      sourceKind: "direct",
      directOrigin: "admin",
      grantedByPersonId: identity.personId,
    });

    expect(
      await setScimIdentityActive(
        source.id,
        connectionId,
        false,
        "keep_memberships",
      ),
    ).toBe(true);
    const [dormantGrant] = await db
      .select({ revokedAt: schema.membershipGrantTable.revokedAt })
      .from(schema.membershipGrantTable)
      .where(
        eq(
          schema.membershipGrantTable.id,
          "person-lifecycle-keep-direct-grant",
        ),
      );
    expect(dormantGrant?.revokedAt).toBeNull();
    const [dormantMembership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, identity.personId));
    expect(dormantMembership?.roleId).toBe("person-lifecycle-keep-role");
    const [inactivePerson] = await db
      .select({ active: schema.personTable.active })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, identity.personId));
    expect(inactivePerson?.active).toBe(false);

    expect(
      await setScimIdentityActive(
        source.id,
        connectionId,
        true,
        "keep_memberships",
      ),
    ).toBe(true);
    const [reactivatedPerson] = await db
      .select({ active: schema.personTable.active })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, identity.personId));
    expect(reactivatedPerson?.active).toBe(true);
    const retainedGrant = await db
      .select({
        id: schema.membershipGrantTable.id,
        revokedAt: schema.membershipGrantTable.revokedAt,
      })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.personId, identity.personId));
    expect(retainedGrant).toEqual([
      { id: "person-lifecycle-keep-direct-grant", revokedAt: null },
    ]);
    const activeMemberships = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, identity.personId));
    expect(activeMemberships).toEqual([
      { roleId: "person-lifecycle-keep-role" },
    ]);
  });

  it("IP-15 shares administrative retirement across external and direct grants", async () => {
    const first = await createScimProtocolFixture(
      "person-lifecycle-scim-connection",
      "P".repeat(43),
    );
    const source = await createScimProtocolUser(first.app, first.token, {
      externalId: "person-lifecycle-source",
      userName: "person-lifecycle@example.test",
      displayName: "Lifecycle Person",
      email: "person-lifecycle@example.test",
      title: undefined,
      preferredLanguage: undefined,
    });
    const [linked] = await db
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, source.id));
    if (!linked) throw new Error("Lifecycle identity was not persisted");

    const second = await createScimProtocolFixture(
      "person-lifecycle-other-connection",
      "Q".repeat(43),
    );
    await db.insert(schema.externalIdentityTable).values({
      id: "person-lifecycle-other-identity",
      identityConnectionId: second.connectionId,
      personId: linked.personId,
      issuer: "https://identity.example.test/other",
      subject: "person-lifecycle-other-subject",
      provisionedVia: "jit",
      active: true,
    });
    const internalOrg = await ensureInternalOrganisation();
    const [workspace] = await db
      .insert(schema.workspaceTable)
      .values([
        {
          id: "person-lifecycle-workspace",
          organisationId: internalOrg.id,
          name: "Person lifecycle workspace",
          slug: "person-lifecycle-workspace",
          createdAt: new Date(),
        },
      ])
      .returning({ id: schema.workspaceTable.id });
    if (!workspace) throw new Error("Lifecycle workspace was not created");
    await db.insert(schema.roleTable).values({
      id: "person-lifecycle-role",
      scope: "workspace",
      workspaceId: workspace.id,
      key: "person-lifecycle-role",
      name: "Person lifecycle role",
      rank: 1,
      capabilities: [],
    });
    await db.insert(schema.membershipGrantTable).values([
      {
        id: "person-lifecycle-direct-grant",
        personId: linked.personId,
        scope: "workspace",
        scopeId: workspace.id,
        roleId: "person-lifecycle-role",
        sourceKind: "direct",
        directOrigin: "admin",
        grantedByPersonId: linked.personId,
      },
      {
        id: "person-lifecycle-external-grant",
        personId: linked.personId,
        scope: "workspace",
        scopeId: workspace.id,
        roleId: "person-lifecycle-role",
        sourceKind: "jit_default",
        identityConnectionId: second.connectionId,
        externalIdentityId: "person-lifecycle-other-identity",
      },
    ]);
    await db.insert(schema.userTable).values({
      id: "person-lifecycle-user",
      name: "Lifecycle Person",
      email: "person-lifecycle@example.test",
      role: null,
    });
    await db
      .update(schema.personTable)
      .set({ userId: "person-lifecycle-user" })
      .where(eq(schema.personTable.id, linked.personId));
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: "person-lifecycle-session",
      token: "person-lifecycle-session-token",
      userId: "person-lifecycle-user",
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apikeyTable).values({
      id: "person-lifecycle-key",
      referenceId: "person-lifecycle-user",
      userId: "person-lifecycle-user",
      key: "person-lifecycle-api-key",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const changed = await db.transaction((tx) =>
      transitionPersonLifecycleInTransaction(
        tx,
        linked.personId,
        false,
        "end_memberships",
        { kind: "administrative" },
      ),
    );
    expect(changed).toMatchObject({
      sessionsRevoked: 1,
      keysRevoked: 1,
      membershipsEnded: 2,
    });
    const retired = await db
      .select({
        id: schema.membershipGrantTable.id,
        reason: schema.membershipGrantTable.revocationReason,
      })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, linked.personId),
          isNotNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(retired).toEqual(
      expect.arrayContaining([
        { id: "person-lifecycle-direct-grant", reason: "person_deactivated" },
        { id: "person-lifecycle-external-grant", reason: "person_deactivated" },
      ]),
    );
    expect(
      await db
        .select({ reason: schema.membershipGrantTable.revocationReason })
        .from(schema.membershipGrantTable)
        .where(
          and(
            eq(
              schema.membershipGrantTable.externalIdentityId,
              "person-lifecycle-other-identity",
            ),
            isNotNull(schema.membershipGrantTable.revokedAt),
          ),
        ),
    ).toEqual([{ reason: "person_deactivated" }]);
    expect(
      await db
        .select({ id: schema.membershipTable.id })
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.personId, linked.personId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, "person-lifecycle-user")),
    ).toEqual([]);
    expect(
      await db
        .select({ enabled: schema.apikeyTable.enabled })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, "person-lifecycle-key")),
    ).toEqual([{ enabled: false }]);
    expect(
      await db
        .select({ active: schema.externalIdentityTable.active })
        .from(schema.externalIdentityTable)
        .where(
          eq(
            schema.externalIdentityTable.id,
            "person-lifecycle-other-identity",
          ),
        ),
    ).toEqual([{ active: true }]);
  });

  it("rejects duplicate group creation without returning a resource id", async () => {
    const { app, token } = await createScimProtocolFixture();
    const body = JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      externalId: "isolated-group",
      displayName: "Isolated Group",
      members: [],
    });
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/scim+json",
    };
    const first = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).toBe(201);
    const duplicate = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers,
      body,
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).not.toHaveProperty("id");
  });

  it("returns SCIM username-filter and group collection protocol responses", async () => {
    const { app, token } = await createScimProtocolFixture();
    const user = await createScimProtocolUser(app, token);
    const headers = { authorization: `Bearer ${token}` };

    const filteredUsers = await app.request(
      `/scim/v2/Users?filter=${encodeURIComponent('userName eq "isolated@example.test"')}`,
      { headers },
    );
    expect(filteredUsers.status).toBe(200);
    expect(filteredUsers.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await filteredUsers.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [{ id: user.id, userName: "isolated@example.test" }],
    });

    const groupCreated = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "isolated-group",
        displayName: "Isolated Group",
        members: [{ value: user.id, type: "User" }],
      }),
    });
    expect(groupCreated.status).toBe(201);
    const group = (await groupCreated.json()) as { id: string };

    const listedGroups = await app.request(
      "/scim/v2/Groups?startIndex=1&count=10",
      { headers },
    );
    expect(listedGroups.status).toBe(200);
    expect(listedGroups.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    expect(await listedGroups.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          id: group.id,
          externalId: "isolated-group",
          displayName: "Isolated Group",
          members: [{ value: user.id, type: "User" }],
        },
      ],
    });

    const readGroup = await app.request(`/scim/v2/Groups/${group.id}`, {
      headers,
    });
    expect(readGroup.status).toBe(200);
    expect(await readGroup.json()).toMatchObject({
      id: group.id,
      externalId: "isolated-group",
      displayName: "Isolated Group",
    });
  });

  it("filters only configured, representable attributes within the authenticated SCIM connection", async () => {
    const { app, token, connectionId } = await createScimProtocolFixture();
    const ownUser = await createScimProtocolUser(app, token, {
      externalId: "configured-user",
      userName: "configured@example.test",
      displayName: "Configured User",
      email: "configured@example.test",
      title: "Support Engineer",
      preferredLanguage: "en-GB",
    });
    const otherConnection = await createScimProtocolFixture(
      "scim-protocol-other-connection",
      "G".repeat(43),
    );
    await createScimProtocolUser(otherConnection.app, otherConnection.token, {
      externalId: "other-configured-user",
      userName: "other-configured@example.test",
      displayName: "Configured User",
      email: "other-configured@example.test",
      title: "Support Engineer",
      preferredLanguage: "en-GB",
    });
    const configuredAttributes = [
      "externalId",
      "userName",
      "displayName",
      "name.formatted",
      "title",
      "preferredLanguage",
    ];
    await db
      .update(schema.scimConnectionTable)
      .set({ matchAttributes: configuredAttributes })
      .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId));

    const filter = async (expression: string) =>
      app.request(`/scim/v2/Users?filter=${encodeURIComponent(expression)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    for (const expression of [
      'displayName eq "CONFIGURED USER"',
      'name.formatted eq "Configured User"',
      'title eq "Support Engineer"',
      'preferredLanguage eq "EN-gb"',
      'userName eq "CONFIGURED@EXAMPLE.TEST"',
      'externalId eq "CONFIGURED-USER"',
    ]) {
      const response = await filter(expression);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        totalResults: 1,
        Resources: [{ id: ownUser.id }],
      });
    }

    for (const expression of [
      'emails.value eq "configured@example.test"',
      'locale eq "en"',
      'displayName eq "Configured User" and title eq "Support"',
    ]) {
      expect((await filter(expression)).status).toBe(400);
    }

    await db
      .update(schema.scimConnectionTable)
      .set({ matchAttributes: ["externalId", "userName"] })
      .where(eq(schema.scimConnectionTable.identityConnectionId, connectionId));
    expect((await filter('displayName eq "Configured User"')).status).toBe(400);
  });

  it("allows a linked account to receive its own SCIM profile replacement", async () => {
    const { app, token } = await createScimProtocolFixture();
    const user = await createScimProtocolUser(app, token);
    const [account] = await db
      .insert(schema.userTable)
      .values({
        id: "scim-protocol-isolated-account",
        name: "Isolated User Account",
        email: "isolated@example.test",
        role: null,
      })
      .returning({ id: schema.userTable.id });
    if (!account) throw new Error("SCIM protocol fixture account missing");
    const [identity] = await db
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, user.id));
    if (!identity) throw new Error("SCIM protocol fixture identity missing");
    await db
      .update(schema.personTable)
      .set({ userId: account.id })
      .where(eq(schema.personTable.id, identity.personId));

    const replaced = await app.request(`/scim/v2/Users/${user.id}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "isolated-user",
        userName: "isolated@example.test",
        displayName: "Updated Isolated User",
        emails: [{ value: "isolated@example.test", primary: true }],
      }),
    });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      displayName: "Updated Isolated User",
    });
  });

  it("applies a valid SCIM User PATCH to the canonical wire representation", async () => {
    const { app, token } = await createScimProtocolFixture();
    const user = await createScimProtocolUser(app, token);
    const patched = await app.request(`/scim/v2/Users/${user.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "title", value: "Support" }],
      }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: "Support" });
  });

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

    for (const [path, expectedSchema] of [
      [
        "/scim/v2/ResourceTypes",
        "urn:ietf:params:scim:api:messages:2.0:ListResponse",
      ],
      [
        "/scim/v2/Schemas",
        "urn:ietf:params:scim:api:messages:2.0:ListResponse",
      ],
    ] as const) {
      const discovery = await app.request(path, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(discovery.status).toBe(200);
      expect(discovery.headers.get("content-type")).toContain(
        "application/scim+json",
      );
      expect(await discovery.json()).toMatchObject({
        schemas: [expectedSchema],
        Resources: expect.any(Array),
      });
    }

    for (const authorization of [
      undefined,
      "Basic not-a-scim-token",
      "Bearer short",
    ]) {
      const headers = new Headers();
      if (authorization) headers.set("authorization", authorization);
      const denied = await app.request("/scim/v2/ServiceProviderConfig", {
        headers,
      });
      expect(denied.status).toBe(401);
      expect(denied.headers.get("content-type")).toContain(
        "application/scim+json",
      );
      expect(denied.headers.get("cache-control")).toBe("no-store");
      expect(denied.headers.get("set-cookie")).toBeNull();
      expect(await denied.json()).toMatchObject({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "401",
      });
    }

    // The host guard keys on the explicit `Host` header, so the probe must send the
    // configured portal authority; a request without it is rejected as an invalid host
    // whether or not the SCIM-specific guard exists.
    const portalHeaders = {
      authorization: `Bearer ${token}`,
      host: "portal.localhost:5174",
    };
    const portalProbe = await app.request(
      "http://portal.localhost:5174/scim/v2/ServiceProviderConfig",
      { headers: portalHeaders },
    );
    expect(portalProbe.status).toBe(404);
    expect(portalProbe.headers.get("set-cookie")).toBeNull();
    const portalPeopleBefore = await db.select().from(schema.personTable);
    const portalWrite = await app.request(
      "http://portal.localhost:5174/scim/v2/Users",
      {
        method: "POST",
        headers: {
          ...portalHeaders,
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "portal-host-write@example.test",
          externalId: "portal-host-write",
          active: true,
        }),
      },
    );
    expect(portalWrite.status).toBe(404);
    expect(portalWrite.headers.get("set-cookie")).toBeNull();
    expect(await db.select().from(schema.personTable)).toHaveLength(
      portalPeopleBefore.length,
    );

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
    const foreignToken = "C".repeat(43);
    await db.insert(schema.scimConnectionTable).values({
      identityConnectionId: "scim-protocol-foreign-connection",
      tokenHash: sha256(foreignToken),
      tokenPrefix: foreignToken.slice(0, 8),
      tokenCreatedAt: new Date(),
      allowedResources: ["users", "groups"],
      enabled: true,
    });
    await db.insert(schema.personTable).values({
      id: "scim-protocol-foreign-person",
      organisationId: internalOrganisation.id,
      side: "staff",
      displayName: "Foreign Directory Person",
      isPlaceholder: true,
    });
    await db.insert(schema.externalIdentityTable).values({
      id: "scim-protocol-foreign-identity",
      identityConnectionId: "scim-protocol-foreign-connection",
      personId: "scim-protocol-foreign-person",
      issuer: "https://identity.example.test/foreign",
      subject: "foreign-subject",
      scimExternalId: "foreign-external",
      userNameSnapshot: "foreign@example.test",
      emailSnapshot: "foreign@example.test",
      provisionedVia: "scim",
      active: true,
    });
    const foreignUserDenied = await app.request(
      "/scim/v2/Users/scim-protocol-foreign-identity",
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(foreignUserDenied.status).toBe(404);
    const foreignUserRead = await app.request(
      "/scim/v2/Users/scim-protocol-foreign-identity",
      { headers: { authorization: `Bearer ${foreignToken}` } },
    );
    expect(foreignUserRead.status).toBe(200);
    const foreignDirectory = (await app.request("/scim/v2/Users", {
      headers: { authorization: `Bearer ${foreignToken}` },
    })) as Response;
    expect(foreignDirectory.status).toBe(200);
    expect(await foreignDirectory.json()).toMatchObject({
      totalResults: 1,
      Resources: [{ id: "scim-protocol-foreign-identity" }],
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
    const [deprovisionedIdentity] = await db
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.id, provisionedResource.id));
    if (!deprovisionedIdentity)
      throw new Error("deprovisioned identity fixture missing");
    const [deprovisionedEvent] = await db
      .select()
      .from(schema.outboxTable)
      .where(
        and(
          eq(schema.outboxTable.kind, "identity.deprovisioned"),
          sql`${schema.outboxTable.payload}->'payload'->>'personId' = ${deprovisionedIdentity.personId}`,
        ),
      );
    expect(deprovisionedEvent?.payload).toMatchObject({
      scope: {},
      payload: {
        source: "scim",
        identityConnectionId: CONNECTION_ID,
        personId: deprovisionedIdentity.personId,
        sessionsRevoked: 1,
        keysRevoked: 1,
        membershipsEnded: expect.any(Number),
      },
    });
    const deprovisionedAudit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "identity.deprovisioned"),
          eq(schema.auditLogTable.entityId, deprovisionedIdentity.personId),
        ),
      );
    expect(deprovisionedAudit).toHaveLength(1);
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
    const scimRetirementReasons = await db
      .select({ reason: schema.membershipGrantTable.revocationReason })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(
            schema.membershipGrantTable.externalIdentityId,
            provisionedResource.id,
          ),
          eq(schema.membershipGrantTable.revocationReason, "scim_deactivated"),
        ),
      );
    expect(scimRetirementReasons.length).toBeGreaterThan(0);

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
    const [noGrantAfterGroupDelete] = await db
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
    expect(noGrantAfterGroupDelete).toBeUndefined();
    const revokedGroupLedger = await db
      .select({
        revokedAt: schema.scimGroupMemberTable.revokedAt,
        membershipId: schema.scimGroupMemberTable.membershipId,
      })
      .from(schema.scimGroupMemberTable)
      .where(
        and(
          eq(
            schema.scimGroupMemberTable.externalIdentityId,
            provisionedResource.id,
          ),
          eq(
            schema.scimGroupMemberTable.scimGroupMappingId,
            "scim-protocol-group-mapping",
          ),
        ),
      );
    expect(revokedGroupLedger.length).toBeGreaterThan(0);
    expect(revokedGroupLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revokedAt: expect.any(Date),
          membershipId: null,
        }),
      ]),
    );
    const softDeletedRead = await app.request(
      `/scim/v2/Groups/${groupResource.id}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(softDeletedRead.status).toBe(200);
    expect(await softDeletedRead.json()).toMatchObject({
      active: false,
      members: [],
    });

    const reactivatedGroupWithoutEvidence = await app.request(
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
          active: true,
          members: [],
        }),
      },
    );
    expect(reactivatedGroupWithoutEvidence.status).toBe(200);
    const [noGrantAfterReactivation] = await db
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
    expect(noGrantAfterReactivation).toBeUndefined();

    await db
      .update(schema.scimConnectionTable)
      .set({ allowedResources: ["users"] })
      .where(
        eq(schema.scimConnectionTable.identityConnectionId, CONNECTION_ID),
      );
    const groupsReadDenied = await app.request("/scim/v2/Groups", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(groupsReadDenied.status).toBe(403);
    const groupsListDenied = await app.request(
      `/scim/v2/Groups/${groupResource.id}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(groupsListDenied.status).toBe(403);
    const groupWriteDenied = await app.request("/scim/v2/Groups", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "forbidden-group",
        displayName: "Forbidden group",
        members: [],
      }),
    });
    expect(groupWriteDenied.status).toBe(403);
    expect(
      await app.request("/scim/v2/Users?count=1", {
        headers: { authorization: `Bearer ${token}` },
      }),
    ).toHaveProperty("status", 200);
    const [notCreatedForbiddenGroup] = await db
      .select({ id: schema.scimGroupTable.id })
      .from(schema.scimGroupTable)
      .where(eq(schema.scimGroupTable.externalId, "forbidden-group"));
    expect(notCreatedForbiddenGroup).toBeUndefined();

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
      matchAttributes: ["externalId", "userName"],
      mappings: [],
    });
    expect(JSON.stringify(safeSettings)).not.toContain("clientSecret");
    expect(JSON.stringify(safeSettings)).not.toContain("test-client-secret");
    expect(JSON.stringify(safeSettings)).not.toContain("tokenPrefix");
    expect(JSON.stringify(safeSettings)).not.toContain("tokenHash");

    const targetId = "scim-options-target";
    await db.insert(schema.workspaceTable).values({
      id: targetId,
      organisationId: person.organisationId,
      name: "Eligible selector workspace",
      slug: "scim-options-target",
      createdAt: now,
    });
    await db.insert(schema.roleTable).values([
      {
        id: "scim-options-eligible-role",
        scope: "workspace",
        workspaceId: targetId,
        key: "scim-options-eligible",
        name: "Eligible role",
        rank: 5,
        capabilities: [],
      },
      {
        id: "scim-options-over-ceiling-role",
        scope: "workspace",
        workspaceId: targetId,
        key: "scim-options-over-ceiling",
        name: "Over ceiling role",
        rank: 11,
        capabilities: [],
      },
      {
        id: "scim-options-instance-role",
        scope: "workspace",
        workspaceId: targetId,
        key: "scim-options-instance-role",
        name: "Forbidden instance role",
        rank: 4,
        capabilities: ["instance:admin"],
      },
    ]);
    const optionsUrl = `/api/instance/identity-connections/${CONNECTION_ID}/scim/mapping-options`;
    const targetsResponse = await app.request(`${optionsUrl}?limit=1`, {
      headers: { cookie: sessionCookie },
    });
    expect(targetsResponse.status).toBe(200);
    const firstTargetPage = (await targetsResponse.json()) as {
      kind: string;
      data: Array<{ id: string; name: string }>;
      nextCursor: string | null;
    };
    expect(firstTargetPage.kind).toBe("agent_targets");
    expect(firstTargetPage.data).toHaveLength(1);
    if (firstTargetPage.nextCursor) {
      const nextPage = await app.request(
        `${optionsUrl}?limit=1&cursor=${encodeURIComponent(firstTargetPage.nextCursor)}`,
        { headers: { cookie: sessionCookie } },
      );
      expect(nextPage.status).toBe(200);
    }
    const allTargetIds = new Set<string>();
    let targetCursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "1" });
      if (targetCursor) query.set("cursor", targetCursor);
      const page = await app.request(`${optionsUrl}?${query}`, {
        headers: { cookie: sessionCookie },
      });
      const body = (await page.json()) as {
        data: Array<{ id: string }>;
        nextCursor: string | null;
      };
      for (const target of body.data) allTargetIds.add(target.id);
      targetCursor = body.nextCursor;
    } while (targetCursor);
    expect(allTargetIds.has(targetId)).toBe(true);
    const roleOptions = await app.request(
      `${optionsUrl}?workspaceId=${targetId}&limit=2`,
      { headers: { cookie: sessionCookie } },
    );
    expect(roleOptions.status).toBe(200);
    expect(await roleOptions.json()).toMatchObject({
      kind: "agent_roles",
      target: { id: targetId, name: "Eligible selector workspace" },
      data: [{ id: "scim-options-eligible-role", rank: 5 }],
    });
    const invalidCursor = await app.request(
      `${optionsUrl}?cursor=not-a-cursor`,
      {
        headers: { cookie: sessionCookie },
      },
    );
    expect(invalidCursor.status).toBe(400);
    const missingConnection = await app.request(
      "/api/instance/identity-connections/missing/scim/mapping-options",
      { headers: { cookie: sessionCookie } },
    );
    expect(missingConnection.status).toBe(404);

    const request = {
      configVersion: 1,
      kind: "settings",
      lifecyclePolicy: "keep_memberships",
      matchAttributes: ["externalId", "userName", "displayName"],
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
      data: { lifecyclePolicy: string; matchAttributes: string[] };
    };
    expect(updatedSettings.configVersion).toBe(2);
    expect(updatedSettings.data.lifecyclePolicy).toBe("keep_memberships");
    expect(updatedSettings.data.matchAttributes).toEqual([
      "externalId",
      "userName",
      "displayName",
    ]);
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
