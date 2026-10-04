import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
} from "../../apps/api/src/identity/client-secret";
import {
  bindOidcSessionProvenance,
  bindTwoFactorOidcSession,
} from "../../apps/api/src/identity/oidc-login";
import * as oidcProvider from "../../apps/api/src/identity/oidc-provider";
import * as oidcToken from "../../apps/api/src/identity/oidc-token";
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

vi.mock("../../apps/api/src/identity/oidc-provider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/identity/oidc-provider")
    >();
  return {
    ...actual,
    loadEntraDiscovery: vi.fn(async (tenantId: string) => ({
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorizationEndpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenEndpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    })),
    exchangeEntraCode: vi.fn(async () => ({ idToken: "opaque-test-id-token" })),
    loadEntraJwks: vi.fn(async () => ({ keys: [] })),
  };
});

vi.mock("../../apps/api/src/identity/oidc-token", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/identity/oidc-token")
    >();
  return {
    ...actual,
    validateEntraIdToken: vi.fn(
      (
        _token: string,
        _jwks: unknown,
        expectation: { issuer: string; tenantId: string },
      ) => ({
        ok: true as const,
        claims: {
          iss: expectation.issuer,
          tid: expectation.tenantId,
          oid: "direct-oidc-subject",
          email: "direct-oidc@example.test",
          email_verified: true,
          name: "Direct OIDC User",
          acct: 0,
          roles: ["TaskDesk.User"],
        },
      }),
    ),
  };
});

const ENCRYPTION_KEY = "c3".repeat(32);
const PASSWORD = "Connection-admin-password-92!";
const ADMIN_ID = "connection-admin-test-user";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;
const originalPreviousEncryptionKey =
  process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;

async function setupAdmin() {
  const now = new Date();
  const [admin] = await db
    .insert(schema.userTable)
    .values({
      id: ADMIN_ID,
      name: "Identity Administrator",
      email: "identity-admin@example.test",
      role: "admin",
    })
    .returning();
  if (!admin) throw new Error("Identity administrator fixture was not created");
  await ensureStaffPersonForUser(admin.id);
  const [person] = await db
    .select({
      id: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, admin.id))
    .limit(1);
  if (!person) throw new Error("Identity administrator person was not created");
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
  return {
    admin,
    person,
    sessionCookie: `__Host-tdk_agent_session=token-${admin.id}`,
  };
}

async function createConnection(id: string, enabled: boolean) {
  const [adminPerson] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, ADMIN_ID))
    .limit(1);
  if (!adminPerson) throw new Error("Identity administrator person is missing");
  await db.insert(schema.identityConnectionTable).values({
    id,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: null,
    displayName: `Connection ${id}`,
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(id, "stored-secret-for-test"),
    redirectUri: "http://localhost:1337/api/auth/identity/callback",
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: [],
    jitPolicy: {
      enabled: false,
      default_role_id: null,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: 10,
    enabled,
    createdBy: adminPerson.id,
    updatedBy: adminPerson.id,
  });
}

async function stepUp(
  app: ReturnType<typeof createApp>["app"],
  sessionCookie: string,
  binding: Record<string, unknown>,
) {
  const challengeResponse = await csrfRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(binding),
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
        ...binding,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        method: "password",
        password: PASSWORD,
      }),
    },
    sessionCookie,
  );
  expect(proofResponse.status).toBe(200);
  return (await proofResponse.json()) as { token: string };
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

describe("identity connection administration", () => {
  it("lists only safe connection-scoped event summaries in stable cursor pages", async () => {
    const { sessionCookie } = await setupAdmin();
    const app = createApp().app;
    const connectionId = "identity-event-history-connection";
    const otherConnectionId = "identity-event-history-other";
    await createConnection(connectionId, true);
    await createConnection(otherConnectionId, true);
    const timestamp = new Date("2026-10-05T10:00:00.000Z");
    const older = new Date("2026-10-04T10:00:00.000Z");
    await db.insert(schema.provisioningEventTable).values([
      {
        id: "event-history-a",
        identityConnectionId: connectionId,
        kind: "user.created",
        outcome: "succeeded",
        detail: { privateNote: "never returned" },
        actorType: "scim",
        traceId: "private-trace-id",
        createdAt: older,
      },
      {
        id: "event-history-b",
        identityConnectionId: connectionId,
        kind: "group.member_added",
        outcome: "succeeded",
        detail: { internalReference: "not part of the read DTO" },
        actorType: "scim",
        createdAt: timestamp,
      },
      {
        id: "event-history-c",
        identityConnectionId: connectionId,
        kind: "connection.changed",
        outcome: "succeeded",
        detail: { changed: ["enabled"] },
        actorType: "person",
        createdAt: timestamp,
      },
      {
        id: "event-history-other",
        identityConnectionId: otherConnectionId,
        kind: "auth.failed",
        outcome: "denied",
        detail: {},
        actorType: "oidc",
        createdAt: timestamp,
      },
    ]);
    await db.execute(sql`
      update provisioning_event
      set created_at = case id
        when 'event-history-b' then '2026-10-05T10:00:00.000001Z'::timestamptz
        when 'event-history-c' then '2026-10-05T10:00:00.000002Z'::timestamptz
        else created_at
      end
      where id in ('event-history-b', 'event-history-c')
    `);

    const firstResponse = await app.request(
      `/api/instance/identity-connections/${connectionId}/events?limit=2`,
      { headers: { cookie: sessionCookie } },
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      data: Array<Record<string, unknown>>;
      page: { nextCursor: string | null; hasMore: boolean };
    };
    expect(first.data).toEqual([
      {
        kind: "connection.changed",
        outcome: "succeeded",
        actorType: "person",
        createdAt: timestamp.toISOString(),
      },
      {
        kind: "group.member_added",
        outcome: "succeeded",
        actorType: "scim",
        createdAt: timestamp.toISOString(),
      },
    ]);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toBeTruthy();
    expect(JSON.stringify(first)).not.toContain("event-history");
    expect(JSON.stringify(first)).not.toContain("private-trace-id");
    expect(JSON.stringify(first)).not.toContain("privateNote");
    expect(JSON.stringify(first)).not.toContain("internalReference");

    const nextResponse = await app.request(
      `/api/instance/identity-connections/${connectionId}/events?limit=2&cursor=${encodeURIComponent(first.page.nextCursor ?? "")}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(nextResponse.status).toBe(200);
    expect(await nextResponse.json()).toEqual({
      data: [
        {
          kind: "user.created",
          outcome: "succeeded",
          actorType: "scim",
          createdAt: older.toISOString(),
        },
      ],
      page: { nextCursor: null, hasMore: false },
    });

    const wrongConnectionCursor = await app.request(
      `/api/instance/identity-connections/${otherConnectionId}/events?cursor=${encodeURIComponent(first.page.nextCursor ?? "")}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(wrongConnectionCursor.status).toBe(400);
    const malformedCursor = await app.request(
      `/api/instance/identity-connections/${connectionId}/events?cursor=not-a-cursor`,
      { headers: { cookie: sessionCookie } },
    );
    expect(malformedCursor.status).toBe(400);
    const missingConnection = await app.request(
      "/api/instance/identity-connections/missing/events",
      { headers: { cookie: sessionCookie } },
    );
    expect(missingConnection.status).toBe(404);
    const invalidLimit = await app.request(
      `/api/instance/identity-connections/${connectionId}/events?limit=101`,
      { headers: { cookie: sessionCookie } },
    );
    expect(invalidLimit.status).toBe(400);

    const [ordinaryUser] = await db
      .insert(schema.userTable)
      .values({
        id: "identity-event-history-non-admin",
        name: "Non-admin reader",
        email: "event-reader@example.test",
        role: "member",
      })
      .returning();
    if (!ordinaryUser) throw new Error("Reader fixture was not created");
    await ensureStaffPersonForUser(ordinaryUser.id);
    mockAuthenticatedSession(ordinaryUser);
    const forbidden = await app.request(
      `/api/instance/identity-connections/${connectionId}/events`,
      {
        headers: {
          cookie: `__Host-tdk_agent_session=token-${ordinaryUser.id}`,
        },
      },
    );
    expect(forbidden.status).toBe(403);
  });

  it("tags a session issued by the native OIDC callback with the exact source connection", async () => {
    await setupAdmin();
    const app = createApp().app;
    const connectionId = "native-oidc-session-connection";
    await createConnection(connectionId, true);
    const portalOrigin = new URL(
      process.env.TASKDESK_AGENT_URL || "http://localhost:5173",
    ).origin;
    const redirectUri = `${portalOrigin}/api/auth/identity/${connectionId}/callback`;
    await db
      .update(schema.identityConnectionTable)
      .set({ redirectUri })
      .where(eq(schema.identityConnectionTable.id, connectionId));
    const [ssoUser] = await db
      .insert(schema.userTable)
      .values({
        id: "direct-oidc-existing-user",
        name: "Direct OIDC User",
        email: "direct-oidc@example.test",
      })
      .returning();
    if (!ssoUser) throw new Error("Direct OIDC user fixture was not created");
    const internalOrganisation = await ensureInternalOrganisation();
    const [ssoPerson] = await db
      .insert(schema.personTable)
      .values({
        userId: ssoUser.id,
        organisationId: internalOrganisation.id,
        side: "staff",
      })
      .returning();
    if (!ssoPerson)
      throw new Error("Direct OIDC person fixture was not created");
    await db.insert(schema.externalIdentityTable).values({
      identityConnectionId: connectionId,
      personId: ssoPerson.id,
      userId: ssoUser.id,
      issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
      subject: "direct-oidc-subject",
      userNameSnapshot: "direct-oidc@example.test",
      emailSnapshot: "direct-oidc@example.test",
      active: true,
      provisionedVia: "jit",
    });

    const start = await app.request(
      `/api/auth/identity/${connectionId}/start`,
      { method: "GET", redirect: "manual" },
    );
    expect(start.status).toBe(302);
    const authorizeUrl = new URL(start.headers.get("location") ?? "");
    const state = authorizeUrl.searchParams.get("state");
    const stateCookie = start.headers
      .get("set-cookie")
      ?.match(/(?:^|;\s*)tdk_oidc_state=([^;]+)/u)?.[1];
    expect(state).toBeTruthy();
    expect(stateCookie).toBe(state);

    const callback = await app.request(
      `/api/auth/identity/${connectionId}/callback?code=single-use-test-code&state=${encodeURIComponent(state ?? "")}`,
      {
        method: "GET",
        headers: { cookie: `tdk_oidc_state=${stateCookie}` },
        redirect: "manual",
      },
    );
    expect(vi.mocked(oidcProvider.exchangeEntraCode)).toHaveBeenCalled();
    expect(vi.mocked(oidcToken.validateEntraIdToken)).toHaveBeenCalled();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("/agent");
    const issued = await db
      .select({
        source: schema.sessionTable.identityConnectionId,
        portal: schema.sessionTable.portal,
      })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, ssoUser.id));
    expect(issued).toEqual([{ source: connectionId, portal: "agent" }]);
  });

  it("carries exact connection provenance through the native pending-2FA challenge", async () => {
    await setupAdmin();
    const app = createApp().app;
    const connectionId = "native-oidc-two-factor-connection";
    await createConnection(connectionId, true);
    const portalOrigin = new URL(
      process.env.TASKDESK_AGENT_URL || "http://localhost:5173",
    ).origin;
    const redirectUri = `${portalOrigin}/api/auth/identity/${connectionId}/callback`;
    await db
      .update(schema.identityConnectionTable)
      .set({ redirectUri })
      .where(eq(schema.identityConnectionTable.id, connectionId));
    const [ssoUser] = await db
      .insert(schema.userTable)
      .values({
        id: "two-factor-oidc-existing-user",
        name: "Two Factor OIDC User",
        email: "direct-oidc@example.test",
        twoFactorEnabled: true,
      })
      .returning();
    if (!ssoUser)
      throw new Error("Two factor OIDC user fixture was not created");
    const internalOrganisation = await ensureInternalOrganisation();
    const [ssoPerson] = await db
      .insert(schema.personTable)
      .values({
        userId: ssoUser.id,
        organisationId: internalOrganisation.id,
        side: "staff",
      })
      .returning();
    if (!ssoPerson)
      throw new Error("Two factor OIDC person fixture was not created");
    await db.insert(schema.externalIdentityTable).values({
      identityConnectionId: connectionId,
      personId: ssoPerson.id,
      userId: ssoUser.id,
      issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
      subject: "direct-oidc-subject",
      userNameSnapshot: "direct-oidc@example.test",
      emailSnapshot: "direct-oidc@example.test",
      active: true,
      provisionedVia: "jit",
    });

    const start = await app.request(
      `/api/auth/identity/${connectionId}/start`,
      { method: "GET", redirect: "manual" },
    );
    const authorizeUrl = new URL(start.headers.get("location") ?? "");
    const state = authorizeUrl.searchParams.get("state");
    const stateCookie = start.headers
      .get("set-cookie")
      ?.match(/(?:^|;\s*)tdk_oidc_state=([^;]+)/u)?.[1];
    expect(start.status).toBe(302);
    expect(stateCookie).toBe(state);
    const callback = await app.request(
      `/api/auth/identity/${connectionId}/callback?code=single-use-test-code&state=${encodeURIComponent(state ?? "")}`,
      {
        method: "GET",
        headers: { cookie: `tdk_oidc_state=${stateCookie}` },
        redirect: "manual",
      },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/auth/two-factor");
    expect(callback.headers.get("set-cookie")).toContain(
      "taskdesk_oidc_pending_session=",
    );
    const sourceRows = (
      await db.select().from(schema.verificationTable)
    ).filter((row) => row.identifier.startsWith("oidc-session-source:"));
    expect(sourceRows).toHaveLength(1);
    expect(JSON.parse(sourceRows[0]?.value ?? "{}") as unknown).toMatchObject({
      connectionId,
      portal: "agent",
      userId: ssoUser.id,
    });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, ssoUser.id)),
    ).toEqual([]);
  });

  it("creates a disabled version-one connection only after a matching PA-15 proof and never returns the secret", async () => {
    const { person, sessionCookie, admin } = await setupAdmin();
    const app = createApp().app;
    const request = {
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: null,
      displayName: "Staff sign-in",
      tenantId: TENANT_ID,
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientSecret: "one-time-sensitive-client-secret",
      scopes: ["openid", "profile"],
      claimMapping: { version: 1, displayName: "name" },
      domainBindings: [],
      jitPolicy: {
        enabled: false,
        default_role_id: null,
        required_entra_app_role: "TaskDesk.User",
      },
      maxRoleRank: 10,
    } as const;
    const binding = {
      kind: "operation",
      operation: "identity_connection_create",
      request,
    };
    const proof = await stepUp(app, sessionCookie, binding);
    const mismatched = await csrfRequest(
      app,
      "/api/instance/identity-connections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": proof.token,
        },
        body: JSON.stringify({
          ...request,
          displayName: "Different operation",
        }),
      },
      sessionCookie,
    );
    expect(mismatched.status).toBe(403);
    expect(await db.select().from(schema.identityConnectionTable)).toHaveLength(
      0,
    );
    const [otherAdmin] = await db
      .insert(schema.userTable)
      .values({
        id: "connection-admin-wrong-session",
        name: "Other administrator",
        email: "other-identity-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!otherAdmin)
      throw new Error("Other administrator fixture was not created");
    await ensureStaffPersonForUser(otherAdmin.id);
    await db.insert(schema.sessionTable).values({
      id: `session-${otherAdmin.id}`,
      token: `token-${otherAdmin.id}`,
      userId: otherAdmin.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mockAuthenticatedSession(otherAdmin);
    const wrongSession = await csrfRequest(
      app,
      "/api/instance/identity-connections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": proof.token,
        },
        body: JSON.stringify(request),
      },
      `__Host-tdk_agent_session=token-${otherAdmin.id}`,
    );
    expect(wrongSession.status).toBe(403);
    mockAuthenticatedSession(admin);
    const response = await csrfRequest(
      app,
      "/api/instance/identity-connections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": proof.token,
        },
        body: JSON.stringify(request),
      },
      sessionCookie,
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      data: {
        id: string;
        enabled: boolean;
        configVersion: number;
        clientSecretConfigured: boolean;
      };
    };
    expect(result.data).toMatchObject({
      enabled: false,
      configVersion: 1,
      clientSecretConfigured: true,
    });
    expect(JSON.stringify(result)).not.toContain(request.clientSecret);
    const [stored] = await db
      .select()
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, result.data.id))
      .limit(1);
    if (!stored) throw new Error("Expected an encrypted identity connection");
    expect(
      decryptIdentityClientSecret(result.data.id, stored.clientSecret),
    ).toBe(request.clientSecret);
    const [event] = await db
      .select({ detail: schema.provisioningEventTable.detail })
      .from(schema.provisioningEventTable)
      .where(
        eq(schema.provisioningEventTable.identityConnectionId, result.data.id),
      )
      .limit(1);
    expect(JSON.stringify(event)).not.toContain(request.clientSecret);
    expect(stored?.createdBy).toBe(person.id);
    const replay = await csrfRequest(
      app,
      "/api/instance/identity-connections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": proof.token,
        },
        body: JSON.stringify(request),
      },
      sessionCookie,
    );
    expect(replay.status).toBe(403);
    expect(await db.select().from(schema.identityConnectionTable)).toHaveLength(
      1,
    );
  });

  it("revokes only sessions tagged to the disabled connection after a version-bound proof", async () => {
    const { person, sessionCookie } = await setupAdmin();
    const app = appForTest();
    const targetId = "disable-source-connection";
    const otherId = "other-source-connection";
    await createConnection(targetId, true);
    await createConnection(otherId, true);
    await db.insert(schema.scimConnectionTable).values({
      identityConnectionId: targetId,
      enabled: false,
    });

    const [ssoUser] = await db
      .insert(schema.userTable)
      .values({
        id: "disable-source-sso-user",
        name: "SSO User",
        email: "sso@example.test",
      })
      .returning();
    if (!ssoUser) throw new Error("SSO fixture user was not created");
    const [ssoPerson] = await db
      .insert(schema.personTable)
      .values({
        userId: ssoUser.id,
        organisationId: person.organisationId,
        side: "agent",
      })
      .returning();
    if (!ssoPerson) throw new Error("SSO fixture person was not created");
    await db.insert(schema.externalIdentityTable).values({
      identityConnectionId: targetId,
      personId: ssoPerson.id,
      userId: ssoUser.id,
      issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
      subject: "source-bound-subject",
      userNameSnapshot: "sso@example.test",
      active: true,
      provisionedVia: "jit",
    });
    const now = new Date();
    await db.insert(schema.sessionTable).values([
      {
        id: "source-bound-session",
        token: "source-bound-token",
        userId: ssoUser.id,
        portal: "agent",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "two-factor-source-session",
        token: "two-factor-source-token",
        userId: ssoUser.id,
        portal: "agent",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "local-session-preserved",
        token: "local-session-token",
        userId: ssoUser.id,
        portal: "agent",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "other-connection-session-preserved",
        token: "other-connection-token",
        userId: ssoUser.id,
        portal: "agent",
        identityConnectionId: otherId,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "disable-race-session",
        token: "disable-race-token",
        userId: ssoUser.id,
        portal: "agent",
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);
    const challengeId = "two-factor-source-challenge";
    await db.insert(schema.verificationTable).values({
      identifier: `oidc-session-source:${createHash("sha256").update(challengeId, "utf8").digest("hex")}`,
      value: JSON.stringify({
        connectionId: targetId,
        portal: "agent",
        userId: ssoUser.id,
      }),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(
      await bindTwoFactorOidcSession({
        challengeId,
        sourceMarker: "different-challenge",
        sessionId: "two-factor-source-session",
        userId: ssoUser.id,
        portal: "agent",
      }),
    ).toBe("invalid");
    expect(
      await bindTwoFactorOidcSession({
        challengeId,
        sourceMarker: challengeId,
        sessionId: "two-factor-source-session",
        userId: ssoUser.id,
        portal: "agent",
      }),
    ).toBe("bound");
    expect(
      await bindOidcSessionProvenance({
        sessionId: "source-bound-session",
        userId: ssoUser.id,
        connectionId: targetId,
        portal: "agent",
      }),
    ).toBe(true);

    const request = { configVersion: 1, enabled: false };
    const createOperationProof = await stepUp(app, sessionCookie, {
      kind: "operation",
      operation: "identity_connection_create",
      request: {
        portalScope: "agent",
        organisationId: null,
        defaultWorkspaceId: null,
        displayName: "Wrong operation proof",
        tenantId: TENANT_ID,
        clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        clientSecret: "non-secret-test-value",
        scopes: ["openid", "profile"],
        claimMapping: { version: 1, displayName: "name" },
        domainBindings: [],
        jitPolicy: {
          enabled: false,
          default_role_id: null,
          required_entra_app_role: "TaskDesk.User",
        },
        maxRoleRank: 10,
      },
    });
    const wrongOperation = await csrfRequest(
      app,
      `/api/instance/identity-connections/${targetId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": createOperationProof.token,
        },
        body: JSON.stringify(request),
      },
      sessionCookie,
    );
    expect(wrongOperation.status).toBe(403);
    const proof = await stepUp(app, sessionCookie, {
      kind: "operation",
      operation: "identity_connection_configure",
      connectionId: targetId,
      request,
    });
    await db
      .update(schema.identityConnectionTable)
      .set({ configVersion: 2 })
      .where(eq(schema.identityConnectionTable.id, targetId));
    const staleVersion = await csrfRequest(
      app,
      `/api/instance/identity-connections/${targetId}`,
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
    expect(staleVersion.status).toBe(409);
    const currentVersionRequest = { ...request, configVersion: 2 };
    const currentProof = await stepUp(app, sessionCookie, {
      kind: "operation",
      operation: "identity_connection_configure",
      connectionId: targetId,
      request: currentVersionRequest,
    });
    const [raceBinding, response] = await Promise.all([
      bindOidcSessionProvenance({
        sessionId: "disable-race-session",
        userId: ssoUser.id,
        connectionId: targetId,
        portal: "agent",
      }),
      csrfRequest(
        app,
        `/api/instance/identity-connections/${targetId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-taskdesk-step-up-token": currentProof.token,
          },
          body: JSON.stringify(currentVersionRequest),
        },
        sessionCookie,
      ),
    ]);
    expect(typeof raceBinding).toBe("boolean");
    expect(response.status).toBe(200);
    const rows = await db
      .select({
        id: schema.sessionTable.id,
        source: schema.sessionTable.identityConnectionId,
      })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, ssoUser.id))
      .orderBy(schema.sessionTable.id);
    expect(rows.filter(({ source }) => source === targetId)).toEqual([]);
    expect(rows).toEqual(
      [
        { id: "local-session-preserved", source: null },
        { id: "other-connection-session-preserved", source: otherId },
        ...(raceBinding ? [] : [{ id: "disable-race-session", source: null }]),
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    const [updated] = await db
      .select({
        enabled: schema.identityConnectionTable.enabled,
        version: schema.identityConnectionTable.configVersion,
      })
      .from(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, targetId));
    expect(updated).toEqual({ enabled: false, version: 3 });
    const [scim] = await db
      .select({ enabled: schema.scimConnectionTable.enabled })
      .from(schema.scimConnectionTable)
      .where(eq(schema.scimConnectionTable.identityConnectionId, targetId));
    expect(scim?.enabled).toBe(false);
  });

  it("keeps the source-only delete cascade from touching local or other-connection sessions", async () => {
    await setupAdmin();
    const sourceA = "delete-source-a";
    const sourceB = "delete-source-b";
    await createConnection(sourceA, false);
    await createConnection(sourceB, false);
    const now = new Date();
    await db.insert(schema.sessionTable).values([
      {
        id: "delete-source-a-session",
        token: "delete-source-a-token",
        userId: ADMIN_ID,
        portal: "agent",
        identityConnectionId: sourceA,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "delete-source-b-session",
        token: "delete-source-b-token",
        userId: ADMIN_ID,
        portal: "agent",
        identityConnectionId: sourceB,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      {
        id: "delete-local-session",
        token: "delete-local-token",
        userId: ADMIN_ID,
        portal: "agent",
        expiresAt: new Date(now.getTime() + 60_000),
      },
    ]);

    // This is a database referential-action invariant only. Production deletion remains
    // behind the pending-action lifecycle and its audit/invalidation contract.
    await db
      .delete(schema.identityConnectionTable)
      .where(eq(schema.identityConnectionTable.id, sourceA));
    const remaining = await db
      .select({
        id: schema.sessionTable.id,
        source: schema.sessionTable.identityConnectionId,
      })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, ADMIN_ID))
      .orderBy(schema.sessionTable.id);
    expect(remaining).toEqual(
      [
        { id: "delete-local-session", source: null },
        { id: "delete-source-b-session", source: sourceB },
        { id: `session-${ADMIN_ID}`, source: null },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });
});

function appForTest() {
  return createApp().app;
}
