import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  auth,
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { accountLinkIntentIdentifier } from "../../apps/api/src/identity/account-link-contract";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { oidcStateCookieName } from "../../apps/api/src/identity/oidc-login";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";

const fixture = vi.hoisted(() => ({
  claims: {} as Record<string, unknown>,
}));

vi.mock("../../apps/api/src/identity/oidc-provider", async (original) => {
  const actual =
    await original<
      typeof import("../../apps/api/src/identity/oidc-provider")
    >();
  return {
    ...actual,
    loadEntraDiscovery: vi.fn(async (tenantId: string) => ({
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorizationEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    })),
    exchangeEntraCode: vi.fn(async () => ({
      idToken: "account-link-id-token",
    })),
    loadEntraJwks: vi.fn(async () => ({ keys: [] })),
  };
});

vi.mock("../../apps/api/src/identity/oidc-token", async (original) => {
  const actual =
    await original<typeof import("../../apps/api/src/identity/oidc-token")>();
  return {
    ...actual,
    validateEntraIdToken: vi.fn(() => ({
      ok: true as const,
      claims: fixture.claims,
    })),
  };
});

const USER_ID = "account-link-user";
const PERSON_ID = "account-link-person";
const SOURCE_ID = "account-link-source";
const TARGET_ID = "account-link-target";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const SUBJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_ID = `session-${USER_ID}`;
const SESSION_COOKIE = `__Host-tdk_agent_session=token-${USER_ID}`;
const ENCRYPTION_KEY = "c9".repeat(32);
const origin = getConfiguredAgentOrigin();

let app: ReturnType<typeof createApp>["app"];

async function seed() {
  await ensureInternalOrganisation();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: USER_ID,
      name: "Account Link User",
      email: "account-link-user@example.test",
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("Account-link user fixture missing");
  const [person] = await db
    .insert(schema.personTable)
    .values({
      id: PERSON_ID,
      userId: user.id,
      organisationId: (await ensureInternalOrganisation()).id,
      side: "staff",
    })
    .returning();
  if (!person) throw new Error("Account-link person fixture missing");

  for (const [id, displayName] of [
    [SOURCE_ID, "Primary Entra"],
    [TARGET_ID, "Secondary Entra"],
  ] as const) {
    await db.insert(schema.identityConnectionTable).values({
      id,
      providerType: "entra",
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: null,
      displayName,
      issuer: ISSUER,
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      clientSecret: encryptIdentityClientSecret(id, "fixture-secret"),
      redirectUri: `${origin}/api/auth/identity/${id}/callback`,
      scopes: ["openid", "profile", "email"],
      claimMapping: { version: 1, displayName: "name" },
      domainBindings: [],
      jitPolicy: {
        enabled: false,
        default_role_id: null,
        required_entra_app_role: "TaskDesk.User",
      },
      maxRoleRank: 5,
      enabled: true,
      createdBy: person.id,
      updatedBy: person.id,
    });
  }
  await db.insert(schema.externalIdentityTable).values({
    id: "account-link-source-identity",
    identityConnectionId: SOURCE_ID,
    personId: person.id,
    userId: user.id,
    issuer: ISSUER,
    subject: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userNameSnapshot: "account-link-user",
    emailSnapshot: user.email,
    active: true,
    provisionedVia: "jit",
  });
  await db.insert(schema.sessionTable).values({
    id: SESSION_ID,
    token: `token-${USER_ID}`,
    userId: USER_ID,
    portal: "agent",
    identityConnectionId: SOURCE_ID,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  mockAuthenticatedSession(user);
}

async function post(path: string, body: unknown = {}) {
  return csrfRequest(
    app,
    path,
    {
      method: "POST",
      headers: {
        cookie: SESSION_COOKIE,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    SESSION_COOKIE,
  );
}

async function completeTargetProof(beforeCallback?: () => void) {
  const started = await post(`/api/me/identity-links/${TARGET_ID}/start`);
  expect(started.status, await started.clone().text()).toBe(200);
  const { authorizationUrl } = (await started.json()) as {
    authorizationUrl: string;
  };
  const authorization = new URL(authorizationUrl);
  const state = authorization.searchParams.get("state");
  const cookieName = oidcStateCookieName(origin.startsWith("https://"));
  const stateCookie = started.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.split(";", 1)[0];
  if (!state || !stateCookie) throw new Error("OIDC state was not issued");
  beforeCallback?.();

  const callback = await app.request(
    `${origin}/api/auth/identity/${TARGET_ID}/callback?code=account-link-code&state=${encodeURIComponent(state)}`,
    {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}; ${stateCookie}` },
      redirect: "manual",
    },
  );
  return callback;
}

async function captureIntent() {
  const callback = await completeTargetProof();
  expect(callback.status, await callback.clone().text()).toBe(302);
  const location = callback.headers.get("location") ?? "";
  const intentId = new URL(location).searchParams.get("identityLinkIntent");
  expect(intentId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  if (!intentId) throw new Error("Account-link intent is missing");
  return intentId;
}

async function seedOtherStaff(suffix: string) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: `account-link-other-${suffix}`,
      name: "Other Staff",
      email: `account-link-other-${suffix}@example.test`,
    })
    .returning();
  if (!user) throw new Error("Other account-link user fixture missing");
  const [person] = await db
    .insert(schema.personTable)
    .values({
      id: `account-link-other-person-${suffix}`,
      userId: user.id,
      organisationId: (await ensureInternalOrganisation()).id,
      side: "staff",
    })
    .returning();
  if (!person) throw new Error("Other account-link person fixture missing");
  return { user, person };
}

beforeEach(async () => {
  vi.clearAllMocks();
  fixture.claims = {};
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  await seed();
  app = createApp().app;
});

describe("IP-18 explicit Entra account linking", () => {
  it("requires an A-session confirmation after proving B and adds no new reach", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "different-email@example.test",
      email_verified: true,
      name: "Secondary Identity",
    };
    const membershipsBefore = await db
      .select({
        id: schema.membershipTable.id,
        scope: schema.membershipTable.scope,
        scopeId: schema.membershipTable.scopeId,
        roleId: schema.membershipTable.roleId,
        seesAll: schema.membershipTable.seesAll,
      })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, PERSON_ID));

    const listed = await app.request(`${origin}/api/me/identity-links`, {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(listed.status, await listed.clone().text()).toBe(200);
    expect(await listed.json()).toMatchObject({
      source: { connectionId: SOURCE_ID, displayName: "Primary Entra" },
      targets: [
        {
          connectionId: TARGET_ID,
          displayName: "Secondary Entra",
          linked: false,
        },
      ],
    });

    const started = await post(`/api/me/identity-links/${TARGET_ID}/start`);
    expect(started.status, await started.clone().text()).toBe(200);
    const { authorizationUrl } = (await started.json()) as {
      authorizationUrl: string;
    };
    const authorization = new URL(authorizationUrl);
    const state = authorization.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookieName = oidcStateCookieName(origin.startsWith("https://"));
    const stateCookie = started.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${cookieName}=`))
      ?.split(";", 1)[0];
    expect(stateCookie).toBeTruthy();
    if (!state || !stateCookie) throw new Error("OIDC state was not issued");

    const callback = await app.request(
      `${origin}/api/auth/identity/${TARGET_ID}/callback?code=account-link-code&state=${encodeURIComponent(state)}`,
      {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE}; ${stateCookie}` },
        redirect: "manual",
      },
    );
    expect(callback.status).toBe(302);
    const location = callback.headers.get("location") ?? "";
    expect(location).toMatch(
      /^https?:\/\/[^/]+\/dashboard\/settings\/account\/security\?identityLinkIntent=[A-Za-z0-9_-]{43}$/u,
    );
    expect(callback.headers.get("set-cookie")).not.toContain(
      "__Host-tdk_agent_session=",
    );

    const [beforeConfirmation] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(beforeConfirmation).toBeUndefined();
    const [accountBeforeConfirmation] = await db
      .select({ id: schema.accountTable.id })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.providerId, `taskdesk-entra:${TARGET_ID}`));
    expect(accountBeforeConfirmation).toBeUndefined();
    const [sessionCount] = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    expect(sessionCount?.id).toBe(SESSION_ID);

    const intentId = new URL(location).searchParams.get("identityLinkIntent");
    expect(intentId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    if (!intentId) throw new Error("Account-link intent is missing");
    const intent = await app.request(
      `${origin}/api/me/identity-links/intents/${intentId}`,
      { headers: { cookie: SESSION_COOKIE } },
    );
    expect(intent.status, await intent.clone().text()).toBe(200);
    expect(await intent.json()).toMatchObject({
      intentId,
      sourceDisplayName: "Primary Entra",
      targetDisplayName: "Secondary Entra",
      accountLabel: "different-email@example.test",
    });

    const confirmed = await post(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    expect(await confirmed.json()).toEqual({
      linked: true,
      alreadyLinked: false,
    });
    const [linkedIdentity] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(linkedIdentity).toMatchObject({
      personId: PERSON_ID,
      userId: USER_ID,
      issuer: ISSUER,
      subject: SUBJECT,
      provisionedVia: "linked",
      active: true,
    });
    const membershipsAfter = await db
      .select({
        id: schema.membershipTable.id,
        scope: schema.membershipTable.scope,
        scopeId: schema.membershipTable.scopeId,
        roleId: schema.membershipTable.roleId,
        seesAll: schema.membershipTable.seesAll,
      })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, PERSON_ID));
    expect(membershipsAfter).toEqual(membershipsBefore);
    const sessionsAfter = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    expect(sessionsAfter).toEqual([{ id: SESSION_ID }]);
    const audit = await db
      .select({
        action: schema.auditLogTable.action,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "identity.linked"));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.after)).not.toContain("different-email");
    const replay = await post(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(replay.status).toBe(404);
    const [replayed] = await db
      .select({ id: schema.verificationTable.id })
      .from(schema.verificationTable);
    expect(replayed).toBeUndefined();
  });

  it("rejects confirmation after the exact source session identity is disabled", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "unrelated@example.test",
      email_verified: true,
    };
    const intentId = await captureIntent();
    await db
      .update(schema.externalIdentityTable)
      .set({ active: false })
      .where(
        eq(schema.externalIdentityTable.id, "account-link-source-identity"),
      );

    const response = await post(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(response.status).toBe(409);
    const [targetIdentity] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(targetIdentity).toBeUndefined();
  });

  it("rejects confirmation from a different browser session", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "secondary@example.test",
      email_verified: true,
    };
    const intentId = await captureIntent();
    const { user: otherUser } = await seedOtherStaff("session");
    await db.insert(schema.sessionTable).values({
      id: `session-${otherUser.id}`,
      token: `token-${otherUser.id}`,
      userId: otherUser.id,
      portal: "agent",
      identityConnectionId: SOURCE_ID,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    await db.insert(schema.externalIdentityTable).values({
      id: "account-link-other-source-identity",
      identityConnectionId: SOURCE_ID,
      personId: "account-link-other-person-session",
      userId: otherUser.id,
      issuer: ISSUER,
      subject: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userNameSnapshot: "other-session-user",
      emailSnapshot: otherUser.email,
      active: true,
      provisionedVia: "jit",
    });
    mockAuthenticatedSession(otherUser);
    const otherCookie = `__Host-tdk_agent_session=token-${otherUser.id}`;
    const response = await csrfRequest(
      app,
      `/api/me/identity-links/intents/${intentId}/confirm`,
      {
        method: "POST",
        headers: {
          cookie: otherCookie,
          "content-type": "application/json",
        },
        body: "{}",
      },
      otherCookie,
    );
    expect(response.status).toBe(404);
    const [targetIdentity] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(targetIdentity).toBeUndefined();
  });

  it("rejects a proof when the target configuration changed before confirmation", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "secondary@example.test",
      email_verified: true,
    };
    const intentId = await captureIntent();
    await db
      .update(schema.identityConnectionTable)
      .set({ configVersion: 2 })
      .where(eq(schema.identityConnectionTable.id, TARGET_ID));

    const response = await post(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(response.status).toBe(409);
    const [targetIdentity] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(targetIdentity).toBeUndefined();
  });

  it("rejects an expired proof without creating a target identity", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "secondary@example.test",
      email_verified: true,
    };
    const intentId = await captureIntent();
    await db
      .update(schema.verificationTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(
        eq(
          schema.verificationTable.identifier,
          accountLinkIntentIdentifier(intentId),
        ),
      );

    const response = await post(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(response.status).toBe(404);
    const [targetIdentity] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(targetIdentity).toBeUndefined();
  });

  it("does not link a target subject already owned by a different person", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "same-email-is-not-proof@example.test",
      email_verified: true,
    };
    const { user: otherUser, person: otherPerson } =
      await seedOtherStaff("collision");
    await db.insert(schema.externalIdentityTable).values({
      id: "account-link-foreign-target-identity",
      identityConnectionId: TARGET_ID,
      personId: otherPerson.id,
      userId: otherUser.id,
      issuer: ISSUER,
      subject: SUBJECT,
      userNameSnapshot: "foreign-owner",
      emailSnapshot: "same-email-is-not-proof@example.test",
      active: true,
      provisionedVia: "jit",
    });
    const intentId = await captureIntent();

    const response = await post(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(response.status).toBe(409);
    const [account] = await db
      .select({ id: schema.accountTable.id })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.providerId, `taskdesk-entra:${TARGET_ID}`));
    expect(account).toBeUndefined();
    const [targetIdentity] = await db
      .select({ personId: schema.externalIdentityTable.personId })
      .from(schema.externalIdentityTable)
      .where(
        eq(
          schema.externalIdentityTable.id,
          "account-link-foreign-target-identity",
        ),
      );
    expect(targetIdentity?.personId).toBe(otherPerson.id);
  });

  it.each([
    { label: "guest account", acct: 1, roles: ["TaskDesk.User"] },
    { label: "missing required app role", acct: 0, roles: ["Other.App"] },
  ])("rejects an inadmissible B token: $label", async ({ acct, roles }) => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct,
      roles,
      email: "secondary@example.test",
      email_verified: true,
    };
    const callback = await completeTargetProof();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).not.toContain(
      "identityLinkIntent=",
    );
    expect(callback.headers.get("set-cookie")).not.toContain(
      "__Host-tdk_agent_session=",
    );
    const [candidate] = await db
      .select({ id: schema.verificationTable.id })
      .from(schema.verificationTable);
    expect(candidate).toBeUndefined();
    const [targetIdentity] = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.identityConnectionId, TARGET_ID));
    expect(targetIdentity).toBeUndefined();
  });

  it("does not create an intent or session if the callback has no A session", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "secondary@example.test",
      email_verified: true,
    };
    const callback = await completeTargetProof(() => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).not.toContain(
      "identityLinkIntent=",
    );
    expect(callback.headers.get("set-cookie")).not.toContain(
      "__Host-tdk_agent_session=",
    );
    const [candidate] = await db
      .select({ id: schema.verificationTable.id })
      .from(schema.verificationTable);
    expect(candidate).toBeUndefined();
    const sessions = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(SESSION_ID);
  });

  it("rejects a B subject that is not a canonical Entra object id", async () => {
    fixture.claims = {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: "not-an-object-id",
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "secondary@example.test",
      email_verified: true,
    };
    const callback = await completeTargetProof();
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).not.toContain(
      "identityLinkIntent=",
    );
    const [candidate] = await db
      .select({ id: schema.verificationTable.id })
      .from(schema.verificationTable);
    expect(candidate).toBeUndefined();
  });

  it("does not mount agent identity-link routes on the customer host", async () => {
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, USER_ID));
    if (!user) throw new Error("Account-link user fixture missing");
    mockAuthenticatedSession(user, { portal: "customer" });
    const response = await app.request(
      `${getConfiguredCustomerOrigin()}/api/me/identity-links`,
      {
        headers: {
          cookie: `__Host-tdk_portal_session=token-${USER_ID}`,
        },
      },
    );
    // The customer-host parent guard returns 404 before the agent-only leaf is reachable.
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(SOURCE_ID);
    expect(body).not.toContain("Primary Entra");
  });
});
