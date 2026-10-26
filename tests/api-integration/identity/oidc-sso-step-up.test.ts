import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getConfiguredAgentOrigin } from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { oidcStateCookieName } from "../../../apps/api/src/identity/oidc-login";
import { createApp } from "../../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "../helpers/auth";
import { csrfRequest } from "../helpers/csrf";
import { resetTestDatabase } from "../helpers/database";
import {
  type MockOidcIssuer,
  startMockOidcIssuer,
} from "./helpers/mock-oidc-issuer";

const providerFixture = vi.hoisted(() => ({
  idToken: "",
  jwks: { keys: [] as unknown[] } as unknown,
  exchangeArguments: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../apps/api/src/identity/oidc-provider", async (original) => {
  const actual =
    await original<
      typeof import("../../../apps/api/src/identity/oidc-provider")
    >();
  return {
    ...actual,
    loadEntraDiscovery: vi.fn(async (tenantId: string) => ({
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorizationEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    })),
    exchangeEntraCode: vi.fn(async (input: Record<string, unknown>) => {
      providerFixture.exchangeArguments.push(input);
      return { idToken: providerFixture.idToken };
    }),
    loadEntraJwks: vi.fn(async () => providerFixture.jwks),
  };
});

const ADMIN_ID = "sso-step-up-admin";
const CONNECTION_ID = "sso-step-up-connection";
const SUBJECT = "linked-sso-subject";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENCRYPTION_KEY = "b7".repeat(32);
const SESSION_COOKIE = `__Host-tdk_agent_session=token-${ADMIN_ID}`;
const SESSION_ID = `session-${ADMIN_ID}`;
const SESSION_TOKEN = `token-${ADMIN_ID}`;
const SESSION_TTL = new Date(Date.now() + 60 * 60_000);
const origin = getConfiguredAgentOrigin();
const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const { base32 } = apiRequire("@better-auth/utils/base32") as {
  base32: { decode(value: string): Uint8Array };
};
const { createOTP } = apiRequire("@better-auth/utils/otp") as {
  createOTP(secret: string): { totp(): Promise<string> };
};

let issuer: MockOidcIssuer;
let app: ReturnType<typeof createApp>["app"];
let personId: string;

async function post(cookie: string, path: string, body: unknown) {
  return csrfRequest(
    app,
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

async function seedSsoAdmin() {
  await ensureInternalOrganisation();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: ADMIN_ID,
      name: "SSO Step-up Administrator",
      email: "sso-step-up-admin@example.test",
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("SSO step-up administrator fixture is missing");
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id))
    .limit(1);
  if (!person) throw new Error("SSO step-up staff person fixture is missing");
  personId = person.id;
  const redirectUri = `${origin}/api/auth/identity/${CONNECTION_ID}/callback`;
  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: null,
    displayName: "SSO step-up test connection",
    issuer: ISSUER,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: encryptIdentityClientSecret(CONNECTION_ID, "fixture-secret"),
    redirectUri,
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
    createdBy: personId,
    updatedBy: personId,
  });
  await db.insert(schema.externalIdentityTable).values({
    id: "sso-step-up-external-identity",
    identityConnectionId: CONNECTION_ID,
    personId,
    userId: ADMIN_ID,
    issuer: ISSUER,
    subject: SUBJECT,
    userNameSnapshot: "sso-step-up-admin",
    emailSnapshot: "sso-step-up-admin@example.test",
    active: true,
    provisionedVia: "jit",
  });
  await db.insert(schema.sessionTable).values({
    id: SESSION_ID,
    token: SESSION_TOKEN,
    userId: ADMIN_ID,
    portal: "agent",
    identityConnectionId: CONNECTION_ID,
    expiresAt: SESSION_TTL,
  });
  mockAuthenticatedSession(user);
  return { user, redirectUri };
}

async function makeChallenge(version = 1) {
  const response = await post(SESSION_COOKIE, "/api/me/step-up/challenges", {
    kind: "operation",
    operation: "metrics_token_rotate",
    version,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as {
    challengeId: string;
    nonce: string;
    expiresAt: string;
  };
}

async function startSso(challenge: { challengeId: string; nonce: string }) {
  const response = await post(SESSION_COOKIE, "/api/me/step-up/sso/start", {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
  });
  return response;
}

function signProviderToken(
  nonce: string,
  claims: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  providerFixture.idToken = issuer.signIdToken(
    {
      iss: ISSUER,
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: SUBJECT,
      nonce,
      auth_time: now,
      acct: 0,
      roles: ["TaskDesk.User"],
      email: "sso-step-up-admin@example.test",
      email_verified: true,
      name: "SSO Step-up Administrator",
      ...claims,
    },
    now,
  );
  return now;
}

async function signInThroughOidc() {
  const started = await app.request(
    `${origin}/api/auth/identity/${CONNECTION_ID}/start`,
    { method: "GET", redirect: "manual" },
  );
  expect(started.status).toBe(302);
  const authorizationUrl = started.headers.get("location");
  expect(authorizationUrl).toBeTruthy();
  if (!authorizationUrl)
    throw new Error("OIDC authorization start did not redirect");
  const authorization = new URL(authorizationUrl);
  const state = authorization.searchParams.get("state");
  const nonce = authorization.searchParams.get("nonce");
  expect(state).toBeTruthy();
  expect(nonce).toBeTruthy();
  if (!state || !nonce) throw new Error("OIDC state or nonce is missing");
  signProviderToken(nonce);
  const cookieName = oidcStateCookieName(origin.startsWith("https://"));
  const stateCookie = started.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.split(";", 1)[0];
  expect(stateCookie).toBeTruthy();
  if (!stateCookie) throw new Error("OIDC state cookie is missing");
  const finished = await app.request(
    `${origin}/api/auth/identity/${CONNECTION_ID}/callback?code=sso-test-code&state=${encodeURIComponent(state)}`,
    {
      method: "GET",
      headers: { cookie: stateCookie },
      redirect: "manual",
    },
  );
  expect(finished.status).toBe(302);
  const sessionCookie = finished.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(sessionCookie).toBeTruthy();
  if (!sessionCookie) throw new Error("OIDC session cookie is missing");
  return sessionCookie;
}

async function callback(
  authorizationUrl: string,
  cookieState: string,
  stateOverride?: string,
) {
  const authorization = new URL(authorizationUrl);
  const state = stateOverride ?? authorization.searchParams.get("state") ?? "";
  const cookieName =
    new URL(origin).protocol === "https:"
      ? "__Host-tdk_oidc_step_up_state"
      : "tdk_oidc_step_up_state";
  return app.request(
    `${origin}/api/auth/identity/${CONNECTION_ID}/callback?code=sso-test-code&state=${encodeURIComponent(state)}`,
    {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}; ${cookieName}=${cookieState}` },
      redirect: "manual",
    },
  );
}

async function authorizeSsoProof(input: {
  claims?: Record<string, unknown>;
  callbackState?: string;
  callbackCookieState?: string;
}) {
  const challenge = await makeChallenge();
  const started = await startSso(challenge);
  expect(started.status, await started.clone().text()).toBe(200);
  const { authorizationUrl } = (await started.json()) as {
    authorizationUrl: string;
  };
  const authorization = new URL(authorizationUrl);
  const nonce = authorization.searchParams.get("nonce");
  const state = authorization.searchParams.get("state");
  const cookie = started.headers
    .getSetCookie()
    .find(
      (value) =>
        value.startsWith("__Host-tdk_oidc_step_up_state=") ||
        value.startsWith("tdk_oidc_step_up_state="),
    )
    ?.split(";", 1)[0]
    ?.split("=", 2)[1];
  expect(nonce).toBeTruthy();
  expect(state).toBeTruthy();
  expect(cookie).toBeTruthy();
  signProviderToken(nonce ?? "", input.claims);
  const finished = await callback(
    authorizationUrl,
    input.callbackCookieState ?? decodeURIComponent(cookie ?? ""),
    input.callbackState,
  );
  return { challenge, authorizationUrl, finished };
}

beforeAll(async () => {
  issuer = await startMockOidcIssuer({ tenantId: TENANT_ID });
  providerFixture.jwks = await (await fetch(issuer.jwksUri)).json();
});

afterAll(async () => {
  await issuer.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  providerFixture.exchangeArguments = [];
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  await seedSsoAdmin();
  app = createApp().app;
});

describe("PA-15 Entra prompt=login step-up", () => {
  it("lets an SSO-only account enroll and verify local TOTP without inventing a password", async () => {
    const sessionCookie = await signInThroughOidc();
    const factors = await app.request(`${origin}/api/me/security/factors`, {
      headers: { cookie: sessionCookie },
    });
    expect(factors.status).toBe(200);
    expect(await factors.json()).toMatchObject({
      passwordRequiredForEnrollment: false,
    });

    const enabled = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ issuer: "TaskDesk" }),
    });
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    const enrollment = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(enrollment.backupCodes.length).toBeGreaterThan(0);
    const encodedSecret = new URL(enrollment.totpURI).searchParams.get(
      "secret",
    );
    expect(encodedSecret).toBeTruthy();
    if (!encodedSecret) throw new Error("TOTP enrollment URI has no secret");

    const rawSecret = Buffer.from(base32.decode(encodedSecret)).toString(
      "utf8",
    );
    const verified = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: await createOTP(rawSecret).totp() }),
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    const [user] = await db
      .select({ enabled: schema.userTable.twoFactorEnabled })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, ADMIN_ID));
    expect(user?.enabled).toBe(true);
  });

  it("continues requiring a password before enrollment when a credential account exists", async () => {
    const sessionCookie = await signInThroughOidc();
    await db.insert(schema.accountTable).values({
      id: "sso-step-up-admin-credential",
      accountId: ADMIN_ID,
      providerId: "credential",
      userId: ADMIN_ID,
      password: "fixture-password-hash",
    });
    const factors = await app.request(`${origin}/api/me/security/factors`, {
      headers: { cookie: sessionCookie },
    });
    expect(factors.status).toBe(200);
    expect(await factors.json()).toMatchObject({
      passwordRequiredForEnrollment: true,
    });

    const enabled = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ issuer: "TaskDesk" }),
    });
    expect(enabled.status).toBe(400);
    expect(await enabled.json()).toMatchObject({
      message: expect.any(String),
    });
    const [user] = await db
      .select({ enabled: schema.userTable.twoFactorEnabled })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, ADMIN_ID));
    expect(user?.enabled).toBe(false);
  });

  it("uses the actual signed-token validator and spends one exact operation proof without creating a session", async () => {
    const [beforeSessions] = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    const challenge = await makeChallenge();
    const started = await startSso(challenge);
    expect(started.status, await started.clone().text()).toBe(200);
    const { authorizationUrl } = (await started.json()) as {
      authorizationUrl: string;
    };
    const authorization = new URL(authorizationUrl);
    expect(authorization.searchParams.get("prompt")).toBe("login");
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/u,
    );
    const state = authorization.searchParams.get("state") ?? "";
    const nonce = authorization.searchParams.get("nonce") ?? "";
    expect(state).toContain(challenge.challengeId);
    signProviderToken(nonce);
    const startedCookie = started.headers
      .getSetCookie()
      .find(
        (value) =>
          value.startsWith("__Host-tdk_oidc_step_up_state=") ||
          value.startsWith("tdk_oidc_step_up_state="),
      )
      ?.split(";", 1)[0]
      ?.split("=", 2)[1];
    expect(startedCookie).toBeTruthy();

    const before = await post(SESSION_COOKIE, "/api/me/step-up/sso/status", {
      challengeId: challenge.challengeId,
    });
    expect(await before.json()).toEqual({ status: "pending" });
    const finished = await callback(
      authorizationUrl,
      decodeURIComponent(startedCookie ?? ""),
    );
    expect(providerFixture.exchangeArguments).toHaveLength(1);
    expect(providerFixture.exchangeArguments[0]).toMatchObject({
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      redirectUri: `${origin}/api/auth/identity/${CONNECTION_ID}/callback`,
    });
    expect(finished.status).toBe(302);
    expect(finished.headers.get("location")).toBe(`${origin}/agent`);
    expect(finished.headers.get("set-cookie")).not.toContain(
      "__Host-tdk_agent_session=",
    );

    const afterCallback = await post(
      SESSION_COOKIE,
      "/api/me/step-up/sso/status",
      { challengeId: challenge.challengeId },
    );
    expect(await afterCallback.json()).toEqual({ status: "verified" });
    const replay = await callback(
      authorizationUrl,
      decodeURIComponent(startedCookie ?? ""),
    );
    expect(replay.status).toBe(302);
    expect(providerFixture.exchangeArguments).toHaveLength(1);
    const issued = await post(SESSION_COOKIE, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "sso_prompt_login",
    });
    expect(issued.status, await issued.clone().text()).toBe(200);
    const token = (await issued.json()) as { token: string };
    const [confirmation] = await db
      .select()
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
    expect(confirmation?.authMethod).toBe("sso_prompt_login");
    expect(confirmation?.authenticatedAt).toBeInstanceOf(Date);

    const spent = await post(
      SESSION_COOKIE,
      "/api/instance/observability/metrics-token/rotate",
      { version: 1 },
    );
    // The protected route reads its proof from the header, so resend the request with the token.
    const consumed = await csrfRequest(
      app,
      "/api/instance/observability/metrics-token/rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: SESSION_COOKIE,
          "x-taskdesk-step-up-token": token.token,
        },
        body: JSON.stringify({ version: 1 }),
      },
      SESSION_COOKIE,
    );
    expect(spent.status).toBe(403);
    expect(consumed.status, await consumed.clone().text()).toBe(200);
    const [stored] = await db
      .select({ state: schema.stepUpConfirmationTable.state })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
    expect(stored?.state).toBe("consumed");
    const evidence = await db.query.verificationTable.findFirst({
      where: eq(
        schema.verificationTable.identifier,
        `step-up-oidc-verified:${challenge.challengeId}`,
      ),
    });
    expect(evidence).toBeUndefined();
    const sessions = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(beforeSessions?.id);
    const identities = await db
      .select({ id: schema.externalIdentityTable.id })
      .from(schema.externalIdentityTable);
    expect(identities).toHaveLength(1);
  });

  it.each([
    ["missing auth_time", { auth_time: undefined }],
    ["stale auth_time", { auth_time: Math.floor(Date.now() / 1000) - 6 * 60 }],
    ["future auth_time", { auth_time: Math.floor(Date.now() / 1000) + 2 * 60 }],
    ["changed subject", { oid: "another-subject" }],
    ["changed nonce", { nonce: "not-the-request-nonce" }],
    ["wrong audience", { aud: "another-client" }],
  ])("expires the challenge for %s", async (_label, claims) => {
    const { challenge } = await authorizeSsoProof({ claims });
    const status = await post(SESSION_COOKIE, "/api/me/step-up/sso/status", {
      challengeId: challenge.challengeId,
    });
    expect(await status.json()).toEqual({ status: "failed" });
    const proof = await post(SESSION_COOKIE, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "sso_prompt_login",
    });
    expect(proof.status).toBe(403);
  });

  it("expires an SSO challenge after a mismatched step-up nonce", async () => {
    const { challenge } = await authorizeSsoProof({});
    const rejected = await post(SESSION_COOKIE, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId: challenge.challengeId,
      nonce: Buffer.alloc(32).toString("base64url"),
      method: "sso_prompt_login",
    });
    expect(rejected.status).toBe(403);
    const status = await post(SESSION_COOKIE, "/api/me/step-up/sso/status", {
      challengeId: challenge.challengeId,
    });
    expect(await status.json()).toEqual({ status: "failed" });
  });

  it("does not accept callback state from a different browser cookie", async () => {
    const challenge = await makeChallenge();
    const started = await startSso(challenge);
    const { authorizationUrl } = (await started.json()) as {
      authorizationUrl: string;
    };
    const authorization = new URL(authorizationUrl);
    signProviderToken(authorization.searchParams.get("nonce") ?? "");
    const wrongBrowser = await callback(
      authorizationUrl,
      "wrong-browser-state",
    );
    expect(wrongBrowser.status).toBe(302);
    const status = await post(SESSION_COOKIE, "/api/me/step-up/sso/status", {
      challengeId: challenge.challengeId,
    });
    expect(await status.json()).toEqual({ status: "failed" });
    const proof = await post(SESSION_COOKIE, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "sso_prompt_login",
    });
    expect(proof.status).toBe(403);
    const [confirmation] = await db
      .select({ state: schema.stepUpConfirmationTable.state })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
    expect(confirmation?.state).toBe("challenge");
  });

  it.each(["claim", "static"] as const)(
    "does not offer SSO step-up when upstream MFA mode is %s without a verifier",
    async (mfaUpstreamMode) => {
      await db
        .update(schema.identityConnectionTable)
        .set({ mfaUpstreamMode })
        .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
      const factors = await app.request(`${origin}/api/me/security/factors`, {
        headers: { cookie: SESSION_COOKIE },
      });
      const factorStatus = (await factors.json()) as {
        availableMethods: string[];
      };
      expect(factorStatus.availableMethods).not.toContain("sso_prompt_login");
      const challenge = await makeChallenge();
      const started = await startSso(challenge);
      expect(started.status).toBe(403);
    },
  );

  it("revalidates a revoked connection when the proof is issued", async () => {
    const { challenge } = await authorizeSsoProof({});
    await db
      .update(schema.identityConnectionTable)
      .set({ enabled: false, configVersion: 2 })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    const proof = await post(SESSION_COOKIE, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "sso_prompt_login",
    });
    expect(proof.status).toBe(403);
    const [confirmation] = await db
      .select({
        state: schema.stepUpConfirmationTable.state,
        challengeExpiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
      })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
    expect(confirmation?.state).toBe("challenge");
    expect(confirmation?.challengeExpiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
  });

  it("revalidates connection configuration atomically when the protected action consumes the proof", async () => {
    const { challenge } = await authorizeSsoProof({});
    const proof = await post(SESSION_COOKIE, "/api/me/step-up", {
      kind: "operation",
      operation: "metrics_token_rotate",
      version: 1,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "sso_prompt_login",
    });
    expect(proof.status).toBe(200);
    const { token } = (await proof.json()) as { token: string };
    await db
      .update(schema.identityConnectionTable)
      .set({ mfaUpstreamMode: "static", configVersion: 2 })
      .where(eq(schema.identityConnectionTable.id, CONNECTION_ID));
    const mutation = await csrfRequest(
      app,
      "/api/instance/observability/metrics-token/rotate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: SESSION_COOKIE,
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ version: 1 }),
      },
      SESSION_COOKIE,
    );
    expect(mutation.status).toBe(403);
    const [confirmation] = await db
      .select({ state: schema.stepUpConfirmationTable.state })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
    expect(confirmation?.state).toBe("issued");
  });
});
