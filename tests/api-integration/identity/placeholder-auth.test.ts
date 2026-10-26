import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import { oidcStateCookieName } from "../../../apps/api/src/identity/oidc-login";
import { createApp } from "../../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember, requireRow } from "../helpers/fixtures";
import { nextClientIp } from "../helpers/organization-http";
import { ensureCustomerRole, inviteWorld } from "../helpers/p5-invite";

const providerState = vi.hoisted(() => ({
  otp: null as string | null,
  magicLink: null as string | null,
  oidcEmail: "placeholder.sso@example.test",
  tenantId: "12345678-1234-4234-8234-123456789012",
}));

vi.mock("@taskdesk/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mocks/email")>();
  return {
    ...actual,
    sendOtpEmail: async (_to: string, _subject: string, data: unknown) => {
      providerState.otp =
        typeof data === "object" && data !== null && "otp" in data
          ? String(data.otp)
          : null;
    },
    sendMagicLinkEmail: async (
      _to: string,
      _subject: string,
      data: unknown,
    ) => {
      providerState.magicLink =
        typeof data === "object" && data !== null && "magicLink" in data
          ? String(data.magicLink)
          : null;
    },
  };
});

vi.mock("../../../apps/api/src/identity/oidc-provider", async (original) => {
  const actual =
    await original<
      typeof import("../../../apps/api/src/identity/oidc-provider")
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
    exchangeEntraCode: vi.fn(async () => ({
      idToken: "opaque-placeholder-test",
    })),
    loadEntraJwks: vi.fn(async () => ({ keys: [] })),
  };
});

vi.mock("../../../apps/api/src/identity/oidc-token", async (original) => {
  const actual =
    await original<
      typeof import("../../../apps/api/src/identity/oidc-token")
    >();
  return {
    ...actual,
    validateEntraIdToken: vi.fn(
      (
        _token: string,
        _jwks: unknown,
        expectation: { issuer: string; tenantId: string; nonce: string },
      ) => ({
        ok: true as const,
        claims: {
          iss: expectation.issuer,
          tid: providerState.tenantId,
          oid: "placeholder-sso-subject",
          email: providerState.oidcEmail,
          email_verified: true,
          name: "Verified SSO User",
          acct: 0,
          roles: ["TaskDesk.User"],
          nonce: expectation.nonce,
        },
      }),
    ),
  };
});

type AuthProvider = "password" | "email-otp" | "magic-link";
const PROVIDER_IDS = ["auth.password", "auth.magic-link", "auth.email-otp"];
const INVITATION_COOKIE_PREFIX = "__Host-tdk_customer_invite_";
const CUSTOMER_HOST = "portal.localhost:5174";
const CONNECTION_ID = "placeholder-auth-customer-connection";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const apiRequire = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

const AGENT_ORIGIN = () => getConfiguredAgentOrigin();
const CUSTOMER_ORIGIN = () => getConfiguredCustomerOrigin();

function cookieFrom(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${name}=`))
    ?.split(";", 1)[0];
}

function authHeaders(origin: string, ip = nextClientIp()) {
  return {
    host: new URL(origin).host,
    origin,
    "x-forwarded-for": ip,
    "content-type": "application/json",
  };
}

async function configureLocalProvider(
  provider: AuthProvider,
  portalScope: "agent" | "customer",
) {
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await db.insert(schema.instancePluginConfigTable).values({
    id: randomUUID(),
    pluginId: `auth.${provider}`,
    instanceKey: `placeholder-${portalScope}-${provider}`,
    displayName: `Placeholder ${portalScope} ${provider}`,
    enabled: true,
    config: {},
    scope: "instance",
    workspaceId: null,
    portalScope,
    configVersion: 1,
  });
  await reloadAuthConfiguration();
}

async function createImportedPlaceholder(
  email: string,
  scope:
    | { side: "staff"; organisationId: string; workspaceId: string }
    | {
        side: "customer";
        organisationId: string;
        workspaceId: string;
      },
) {
  // The internal import workspace's staff owner is the import-run actor, even when the
  // imported customer history person belongs to a different organisation.
  const [runActor] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .innerJoin(
      schema.workspaceUserTable,
      eq(schema.workspaceUserTable.userId, schema.personTable.userId),
    )
    .where(eq(schema.workspaceUserTable.workspaceId, scope.workspaceId))
    .limit(1);
  const actorId = runActor?.id;
  if (!actorId) throw new Error("placeholder import actor fixture missing");
  const run = requireRow(
    await db
      .insert(schema.importRunTable)
      .values({
        workspaceId: scope.workspaceId,
        projectId: null,
        pluginId: "import.mcp",
        sourceRef: `placeholder-auth-${randomUUID()}`,
        startedBy: actorId,
        state: "completed",
      })
      .returning(),
    "placeholder import run",
  );
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: scope.organisationId,
        side: scope.side,
        displayName: "Imported history author",
        active: true,
        isPlaceholder: true,
      })
      .returning(),
    "imported placeholder person",
  );
  await db.insert(schema.importPlaceholderClaimTable).values({
    personId: person.id,
    importRunId: run.id,
    normalizedEmail: email.trim().toLowerCase(),
  });
  return { person, run };
}

async function seedAgentPlaceholder(email: string) {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const internal = await ensureInternalOrganisation();
  return {
    workspace,
    internal,
    owner: user,
    ...(await createImportedPlaceholder(email, {
      side: "staff",
      organisationId: internal.id,
      workspaceId: workspace.id,
    })),
  };
}

async function beginCustomerContinuation(
  app: ReturnType<typeof createApp>["app"],
  invited: { id: string; credential: string },
) {
  const origin = CUSTOMER_ORIGIN();
  const ip = nextClientIp();
  const response = await app.request(
    `${origin}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation`,
    {
      method: "POST",
      headers: { ...authHeaders(origin, ip) },
      body: JSON.stringify({ credential: invited.credential }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(204);
  const cookie = cookieFrom(
    response,
    `${INVITATION_COOKIE_PREFIX}${invited.id}`,
  );
  expect(cookie).toBeTruthy();
  return { cookie: cookie as string, ip };
}

function customerAuthHeaders(invitationId: string, cookie: string, ip: string) {
  const origin = CUSTOMER_ORIGIN();
  return {
    ...authHeaders(origin, ip),
    cookie,
    "x-taskdesk-invitation-id": invitationId,
  };
}

async function seedCustomerConnection(organisationId: string) {
  await ensureCustomerRole();
  const [role] = await db
    .select()
    .from(schema.roleTable)
    .where(
      and(
        eq(schema.roleTable.scope, "organisation"),
        isNull(schema.roleTable.workspaceId),
        eq(schema.roleTable.key, "customer"),
      ),
    )
    .limit(1);
  if (!role) throw new Error("customer role fixture missing");
  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "customer",
    organisationId,
    displayName: "Placeholder customer SSO",
    issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    tenantId: TENANT_ID,
    clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientSecret: encryptIdentityClientSecret(CONNECTION_ID, "test-secret"),
    redirectUri: `${CUSTOMER_ORIGIN()}/api/auth/identity/${CONNECTION_ID}/callback`,
    scopes: ["openid", "profile"],
    claimMapping: { version: 1, displayName: "name" },
    domainBindings: ["example.test"],
    jitPolicy: {
      enabled: true,
      default_role_id: role.id,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: null,
    enabled: true,
  });
}

async function completeCustomerSso(
  app: ReturnType<typeof createApp>["app"],
  invited: { id: string; credential: string },
) {
  const origin = CUSTOMER_ORIGIN();
  const { cookie: inviteCookie } = await beginCustomerContinuation(
    app,
    invited,
  );
  const discovered = await app.request(
    `${origin}/api/portal/sign-in/home-realm`,
    {
      method: "POST",
      headers: authHeaders(origin),
      body: JSON.stringify({
        email: providerState.oidcEmail,
        invitationId: invited.id,
      }),
    },
  );
  expect(discovered.status, await discovered.clone().text()).toBe(200);
  const homeRealmCookie = cookieFrom(
    discovered,
    "__Host-tdk_home_realm_continuation",
  );
  expect(homeRealmCookie).toBeTruthy();
  const started = await app.request(
    `${origin}/api/portal/sign-in/home-realm/start`,
    {
      headers: {
        host: CUSTOMER_HOST,
        cookie: `${homeRealmCookie}; ${inviteCookie}`,
      },
      redirect: "manual",
    },
  );
  expect(started.status).toBe(302);
  const state = new URL(started.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  const stateCookie = cookieFrom(
    started,
    oidcStateCookieName(CUSTOMER_ORIGIN().startsWith("https://")),
  );
  expect(state).toBeTruthy();
  expect(stateCookie).toBeTruthy();
  return app.request(
    `${origin}/api/auth/identity/${CONNECTION_ID}/callback?code=provider-test&state=${encodeURIComponent(state as string)}`,
    {
      headers: {
        host: CUSTOMER_HOST,
        cookie: `${stateCookie}; ${inviteCookie}`,
      },
      redirect: "manual",
    },
  );
}

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await reloadAuthConfiguration();
  providerState.otp = null;
  providerState.magicLink = null;
  providerState.oidcEmail = "placeholder.sso@example.test";
  providerState.tenantId = TENANT_ID;
});

describe("IP-30 verified local placeholder auth claims", () => {
  it("claims the same imported staff person only after the consumed OTP", async () => {
    const email = "staff-otp-placeholder@example.test";
    const source = await seedAgentPlaceholder(email);
    await configureLocalProvider("email-otp", "agent");
    const app = createApp().app;
    const origin = AGENT_ORIGIN();
    const sent = await app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email, type: "sign-in" }),
      },
    );
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(providerState.otp).toBeTruthy();
    const signedIn = await app.request(`${origin}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: authHeaders(origin),
      body: JSON.stringify({ email, otp: providerState.otp }),
    });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    expect(cookieFrom(signedIn, "__Host-tdk_agent_session")).toBeTruthy();
    const replay = await app.request(`${origin}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: authHeaders(origin),
      body: JSON.stringify({ email, otp: providerState.otp }),
    });
    expect(replay.status).not.toBe(200);
    expect(cookieFrom(replay, "__Host-tdk_agent_session")).toBeUndefined();
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    const [claim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, source.person.id));
    expect(user?.emailVerified).toBe(true);
    expect(person).toMatchObject({
      id: source.person.id,
      userId: user?.id,
      isPlaceholder: false,
    });
    expect(claim?.claimedAt).toBeInstanceOf(Date);
  });

  it("claims the same imported staff person only after a consumed magic-link callback", async () => {
    const email = "staff-magic-placeholder@example.test";
    const source = await seedAgentPlaceholder(email);
    await configureLocalProvider("magic-link", "agent");
    const app = createApp().app;
    const origin = AGENT_ORIGIN();
    const sent = await app.request(`${origin}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: authHeaders(origin),
      body: JSON.stringify({ email, callbackURL: "/dashboard" }),
    });
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(providerState.magicLink).toBeTruthy();
    const link = new URL(providerState.magicLink as string, origin);
    const verified = await app.request(
      `${origin}${link.pathname}${link.search}`,
      {
        headers: authHeaders(origin),
        redirect: "manual",
      },
    );
    expect(verified.status).toBe(302);
    expect(cookieFrom(verified, "__Host-tdk_agent_session")).toBeTruthy();
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    expect(person).toMatchObject({
      id: source.person.id,
      userId: user?.id,
      isPlaceholder: false,
    });
  });

  it("refuses an invalid OTP without creating a user, session, or claim", async () => {
    const email = "invalid-otp-placeholder@example.test";
    const source = await seedAgentPlaceholder(email);
    await configureLocalProvider("email-otp", "agent");
    const app = createApp().app;
    const origin = AGENT_ORIGIN();
    const sent = await app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email, type: "sign-in" }),
      },
    );
    expect(sent.status).toBe(200);
    expect(providerState.otp).toBeTruthy();
    const wrongOtp = providerState.otp === "000000" ? "000001" : "000000";
    const invalid = await app.request(`${origin}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: authHeaders(origin),
      body: JSON.stringify({ email, otp: wrongOtp }),
    });
    expect(invalid.status).not.toBe(200);
    expect(
      invalid.headers
        .getSetCookie()
        .some((entry) => entry.startsWith("__Host-tdk_agent_session=")),
    ).toBe(false);
    expect(
      await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.email, email)),
    ).toHaveLength(0);
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    const [claim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, source.person.id));
    expect(person).toMatchObject({ userId: null, isPlaceholder: true });
    expect(claim?.claimedAt).toBeNull();
  });

  it("does not claim on password sign-in from emailVerified alone", async () => {
    const email = "verified-password-placeholder@example.test";
    const source = await seedAgentPlaceholder(email);
    const user = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `password-user-${randomUUID()}`,
          name: "Verified without local proof",
          email,
          emailVerified: true,
        })
        .returning(),
      "password user",
    );
    const password = "placeholder-auth-password-92!";
    await db.insert(schema.accountTable).values({
      id: `password-account-${randomUUID()}`,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(password, 4),
    });
    await configureLocalProvider("password", "agent");
    const app = createApp().app;
    const origin = AGENT_ORIGIN();
    const signedIn = await app.request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: authHeaders(origin),
      body: JSON.stringify({ email, password }),
    });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    const [claim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, source.person.id));
    expect(person).toMatchObject({ userId: null, isPlaceholder: true });
    expect(claim?.claimedAt).toBeNull();
  });

  it("customer OTP claim requires a live invitation and preserves the imported person", async () => {
    const world = await inviteWorld();
    const email = "customer-otp-placeholder@example.test";
    const source = await createImportedPlaceholder(email, {
      side: "customer",
      organisationId: world.org.id,
      workspaceId: world.workspaceId,
    });
    await configureLocalProvider("email-otp", "customer");
    const invited = await world.invite(email);
    vi.restoreAllMocks();
    const app = world.app;
    const origin = CUSTOMER_ORIGIN();
    const continuation = await beginCustomerContinuation(app, invited);
    const sent = await app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: customerAuthHeaders(
          invited.id,
          continuation.cookie,
          continuation.ip,
        ),
        body: JSON.stringify({ email, type: "sign-in" }),
      },
    );
    expect(sent.status, await sent.clone().text()).toBe(200);
    const accepted = await app.request(`${origin}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: customerAuthHeaders(
        invited.id,
        continuation.cookie,
        continuation.ip,
      ),
      body: JSON.stringify({ email, otp: providerState.otp }),
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    const [claim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, source.person.id));
    const grants = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, source.person.id),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(person).toMatchObject({
      id: source.person.id,
      userId: user?.id,
      side: "customer",
      organisationId: world.org.id,
      isPlaceholder: false,
    });
    expect(claim?.claimedAt).toBeInstanceOf(Date);
    expect(grants).toHaveLength(1);
    expect((await world.rowOf(invited.id))?.status).toBe("accepted");

    const bypassEmail = "customer-no-invite-placeholder@example.test";
    const bypass = await createImportedPlaceholder(bypassEmail, {
      side: "customer",
      organisationId: world.org.id,
      workspaceId: world.workspaceId,
    });
    const noInvitationSend = await app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email: bypassEmail, type: "sign-in" }),
      },
    );
    if (noInvitationSend.status === 200 && providerState.otp) {
      const noInvitationSignIn = await app.request(
        `${origin}/api/auth/sign-in/email-otp`,
        {
          method: "POST",
          headers: authHeaders(origin),
          body: JSON.stringify({ email: bypassEmail, otp: providerState.otp }),
        },
      );
      expect(noInvitationSignIn.status).not.toBe(200);
      expect(
        cookieFrom(noInvitationSignIn, "__Host-tdk_portal_session"),
      ).toBeUndefined();
    }
    expect(
      await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.email, bypassEmail)),
    ).toHaveLength(0);
    const [bypassPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, bypass.person.id));
    const [bypassClaim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, bypass.person.id));
    expect(bypassPerson).toMatchObject({ userId: null, isPlaceholder: true });
    expect(bypassClaim?.claimedAt).toBeNull();
  });

  it("allows returning customer OTP and magic-link proof without new invitation or claim changes", async () => {
    const world = await inviteWorld();
    const email = "customer-returning-placeholder@example.test";
    const source = await createImportedPlaceholder(email, {
      side: "customer",
      organisationId: world.org.id,
      workspaceId: world.workspaceId,
    });
    await configureLocalProvider("email-otp", "customer");
    const invited = await world.invite(email);
    vi.restoreAllMocks();
    const origin = CUSTOMER_ORIGIN();
    const continuation = await beginCustomerContinuation(world.app, invited);
    const firstSent = await world.app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: customerAuthHeaders(
          invited.id,
          continuation.cookie,
          continuation.ip,
        ),
        body: JSON.stringify({ email, type: "sign-in" }),
      },
    );
    expect(firstSent.status, await firstSent.clone().text()).toBe(200);
    const initialOtp = providerState.otp;
    expect(initialOtp).toBeTruthy();
    const firstLogin = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers: customerAuthHeaders(
          invited.id,
          continuation.cookie,
          continuation.ip,
        ),
        body: JSON.stringify({ email, otp: initialOtp }),
      },
    );
    expect(firstLogin.status, await firstLogin.clone().text()).toBe(200);

    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    const initialGrants = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, source.person.id),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    const initialAudits = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "identity.placeholder_claimed"),
          eq(schema.auditLogTable.entityId, source.person.id),
        ),
      );
    expect(initialAudits).toHaveLength(1);
    expect(initialGrants).toHaveLength(1);

    const replayedOtp = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email, otp: initialOtp }),
      },
    );
    expect(replayedOtp.status).not.toBe(200);
    expect(
      cookieFrom(replayedOtp, "__Host-tdk_portal_session"),
    ).toBeUndefined();

    const returningSent = await world.app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email, type: "sign-in" }),
      },
    );
    expect(returningSent.status, await returningSent.clone().text()).toBe(200);
    expect(providerState.otp).toBeTruthy();
    const returningOtpLogin = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email, otp: providerState.otp }),
      },
    );
    expect(
      returningOtpLogin.status,
      await returningOtpLogin.clone().text(),
    ).toBe(200);
    expect(
      cookieFrom(returningOtpLogin, "__Host-tdk_portal_session"),
    ).toBeTruthy();

    await configureLocalProvider("magic-link", "customer");
    const magicSent = await world.app.request(
      `${origin}/api/auth/sign-in/magic-link`,
      {
        method: "POST",
        headers: authHeaders(origin),
        body: JSON.stringify({ email, callbackURL: "/catalogue" }),
      },
    );
    expect(magicSent.status, await magicSent.clone().text()).toBe(200);
    expect(providerState.magicLink).toBeTruthy();
    const link = new URL(providerState.magicLink as string, origin);
    const magicLogin = await world.app.request(
      `${origin}${link.pathname}${link.search}`,
      { headers: authHeaders(origin), redirect: "manual" },
    );
    expect(magicLogin.status).toBe(302);
    expect(cookieFrom(magicLogin, "__Host-tdk_portal_session")).toBeTruthy();
    const replayedMagic = await world.app.request(
      `${origin}${link.pathname}${link.search}`,
      { headers: authHeaders(origin), redirect: "manual" },
    );
    expect(replayedMagic.status).toBe(302);
    const replayLocation = replayedMagic.headers.get("location");
    expect(replayLocation).toBeTruthy();
    const replayDestination = new URL(replayLocation as string, origin);
    expect(replayDestination.origin).toBe(new URL(origin).origin);
    expect(replayDestination.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(
      cookieFrom(replayedMagic, "__Host-tdk_portal_session"),
    ).toBeUndefined();

    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    const [claim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, source.person.id));
    const finalGrants = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, source.person.id),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    const finalAudits = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "identity.placeholder_claimed"),
          eq(schema.auditLogTable.entityId, source.person.id),
        ),
      );
    expect(person).toMatchObject({
      id: source.person.id,
      userId: user?.id,
      side: "customer",
      organisationId: world.org.id,
      isPlaceholder: false,
    });
    expect(claim?.claimedAt).toBeInstanceOf(Date);
    expect(finalGrants).toEqual(initialGrants);
    expect(finalAudits).toEqual(initialAudits);
    const linkedPeople = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user?.id ?? ""));
    expect(linkedPeople).toEqual([{ id: source.person.id }]);
  });

  it("does not claim a customer placeholder from a verified SSO email", async () => {
    const world = await inviteWorld();
    const email = "customer-sso-placeholder@example.test";
    const source = await createImportedPlaceholder(email, {
      side: "customer",
      organisationId: world.org.id,
      workspaceId: world.workspaceId,
    });
    providerState.oidcEmail = email;
    await seedCustomerConnection(world.org.id);
    const invited = await world.invite(email);
    vi.restoreAllMocks();
    const callback = await completeCustomerSso(world.app, invited);
    expect(callback.status).toBe(302);
    expect((await world.rowOf(invited.id))?.status).toBe("accepted");
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.id, source.person.id));
    const [claim] = await db
      .select()
      .from(schema.importPlaceholderClaimTable)
      .where(eq(schema.importPlaceholderClaimTable.personId, source.person.id));
    expect(person).toMatchObject({ userId: null, isPlaceholder: true });
    expect(claim?.claimedAt).toBeNull();
  });
});
