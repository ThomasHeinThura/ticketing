import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import { acceptCustomerInvitationFromContinuation } from "../../apps/api/src/customer-invitation/service";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { oidcStateCookieName } from "../../apps/api/src/identity/oidc-login";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";
import { type InviteWorld, inviteWorld } from "./helpers/p5-invite";
import { emailMock, sentWorkspaceInvitationEmails } from "./mocks/email";

const providerState = vi.hoisted(() => ({
  otp: null as string | null,
  magicLink: null as string | null,
  oidcEmail: "provider.invitee@example.test",
  emailVerified: true,
  tenantId: "12345678-1234-4234-8234-123456789012",
}));

vi.mock("@taskdesk/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mocks/email")>();
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

vi.mock("../../apps/api/src/identity/oidc-provider", async (original) => {
  const actual =
    await original<
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
    exchangeEntraCode: vi.fn(async () => ({ idToken: "opaque-provider-test" })),
    loadEntraJwks: vi.fn(async () => ({ keys: [] })),
  };
});

vi.mock("../../apps/api/src/identity/oidc-token", async (original) => {
  const actual =
    await original<typeof import("../../apps/api/src/identity/oidc-token")>();
  return {
    ...actual,
    validateEntraIdToken: vi.fn(
      (
        _token: string,
        _jwks: unknown,
        expectation: { issuer: string; tenantId: string; nonce: string },
      ) => {
        if (providerState.tenantId !== expectation.tenantId)
          return { ok: false as const, reason: "tenant_mismatch" as const };
        return {
          ok: true as const,
          claims: {
            iss: expectation.issuer,
            tid: providerState.tenantId,
            oid: "provider-invite-subject",
            email: providerState.oidcEmail,
            email_verified: providerState.emailVerified,
            name: "Provider Invitee",
            acct: 0,
            roles: ["TaskDesk.User"],
            nonce: expectation.nonce,
          },
        };
      },
    ),
  };
});

const CUSTOMER_HOST = "portal.localhost:5174";
const CUSTOMER_ORIGIN = () => getConfiguredCustomerOrigin();
const PROVIDER_IDS = ["auth.password", "auth.magic-link", "auth.email-otp"];
const INVITATION_COOKIE_PREFIX = "__Host-tdk_customer_invite_";
const TENANT_ID = "12345678-1234-4234-8234-123456789012";
const CONNECTION_ID = "invite-provider-customer-connection";
let world: InviteWorld;

function responseCookie(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${name}=`))
    ?.split(";", 1)[0];
}

function cookieValue(cookie: string | undefined): string | null {
  const separator = cookie?.indexOf("=") ?? -1;
  return separator < 0 ? null : (cookie?.slice(separator + 1) ?? null);
}

async function configureCustomerProvider(provider: "email-otp" | "magic-link") {
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await db.insert(schema.instancePluginConfigTable).values({
    id: crypto.randomUUID(),
    pluginId: `auth.${provider}`,
    instanceKey: `p5-invited-${provider}`,
    displayName: `Invited customer ${provider}`,
    enabled: true,
    config: {},
    scope: "instance",
    workspaceId: null,
    portalScope: "customer",
    configVersion: 1,
  });
  await reloadAuthConfiguration();
}

async function beginContinuation(invited: { id: string; credential: string }) {
  const origin = CUSTOMER_ORIGIN();
  const ip = nextClientIp();
  const response = await world.app.request(
    `${origin}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation`,
    {
      method: "POST",
      headers: {
        host: new URL(origin).host,
        origin,
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ credential: invited.credential }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(204);
  const cookie = responseCookie(
    response,
    `${INVITATION_COOKIE_PREFIX}${invited.id}`,
  );
  expect(cookie).toBeTruthy();
  return { cookie: cookie as string, ip };
}

function authRequestHeaders(
  invitationId: string,
  cookie: string,
  ip = nextClientIp(),
) {
  const origin = CUSTOMER_ORIGIN();
  return {
    host: new URL(origin).host,
    origin,
    cookie,
    "x-taskdesk-invitation-id": invitationId,
    "x-forwarded-for": ip,
    "content-type": "application/json",
  };
}

async function userRows(email: string) {
  return db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));
}

async function acceptedCustomerGrants(userId: string) {
  const [person] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId));
  if (!person) return { person: null, grants: [] };
  const grants = await db
    .select()
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, person.id),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    );
  return { person, grants };
}

async function seedCustomerConnection(organisationId: string) {
  const [customerRole] = await db
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
  if (!customerRole) throw new Error("canonical customer role is missing");
  await db.insert(schema.identityConnectionTable).values({
    id: CONNECTION_ID,
    providerType: "entra",
    portalScope: "customer",
    organisationId,
    defaultWorkspaceId: null,
    displayName: "Invited customer provider test",
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
      default_role_id: customerRole.id,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: null,
    enabled: true,
  });
}

async function completeCustomerOidc(invited: {
  id: string;
  credential: string;
}) {
  const origin = CUSTOMER_ORIGIN();
  const { cookie: inviteCookie } = await beginContinuation(invited);
  const discovered = await world.app.request(
    `${origin}/api/portal/sign-in/home-realm`,
    {
      method: "POST",
      headers: {
        host: CUSTOMER_HOST,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: providerState.oidcEmail,
        invitationId: invited.id,
      }),
    },
  );
  expect(discovered.status, await discovered.clone().text()).toBe(200);
  const homeRealmCookie = responseCookie(
    discovered,
    "__Host-tdk_home_realm_continuation",
  );
  expect(homeRealmCookie).toBeTruthy();

  const started = await world.app.request(
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
  const authorization = new URL(started.headers.get("location") ?? "");
  const state = authorization.searchParams.get("state");
  const stateCookieName = oidcStateCookieName(
    CUSTOMER_ORIGIN().startsWith("https://"),
  );
  const stateCookie = responseCookie(started, stateCookieName);
  expect(state).toBeTruthy();
  expect(stateCookie).toBeTruthy();

  const callback = await world.app.request(
    `${origin}/api/auth/identity/${CONNECTION_ID}/callback?code=provider-test&state=${encodeURIComponent(state as string)}`,
    {
      headers: {
        host: CUSTOMER_HOST,
        cookie: `${stateCookie}; ${inviteCookie}`,
      },
      redirect: "manual",
    },
  );
  return { callback, inviteCookie };
}

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await reloadAuthConfiguration();
  providerState.otp = null;
  providerState.magicLink = null;
  providerState.oidcEmail = "provider.invitee@example.test";
  providerState.emailVerified = true;
  providerState.tenantId = TENANT_ID;
  emailMock.configured = true;
  emailMock.failTransport = false;
  sentWorkspaceInvitationEmails.length = 0;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton" })
    .onConflictDoNothing();
  world = await inviteWorld();
});

afterAll(async () => {
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await reloadAuthConfiguration();
});

describe("provider-neutral customer invitation continuation", () => {
  it("accepts an exact-email OTP sign-in and refuses OTP verified for a different address", async () => {
    await configureCustomerProvider("email-otp");
    const invited = await world.invite("otp.invitee@example.test");
    vi.restoreAllMocks();
    const { cookie, ip } = await beginContinuation(invited);
    const origin = CUSTOMER_ORIGIN();
    const sent = await world.app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: authRequestHeaders(invited.id, cookie, ip),
        body: JSON.stringify({ email: invited.email, type: "sign-in" }),
      },
    );
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(providerState.otp).toBeTruthy();

    const signedIn = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers: authRequestHeaders(invited.id, cookie, ip),
        body: JSON.stringify({ email: invited.email, otp: providerState.otp }),
      },
    );
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    expect((await world.rowOf(invited.id))?.status).toBe("accepted");
    const [user] = await userRows(invited.email);
    expect(user).toMatchObject({ emailVerified: true, role: null });
    const { person, grants } = await acceptedCustomerGrants(user?.id as string);
    expect(person).toMatchObject({
      side: "customer",
      organisationId: world.org.id,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      scope: "organisation",
      scopeId: world.org.id,
      sourceKind: "direct",
    });

    const mismatched = await world.invite("otp.mismatch@example.test");
    vi.restoreAllMocks();
    const mismatchContext = await beginContinuation(mismatched);
    const otherEmail = "not-the-invited-address@example.test";
    const otpSent = await world.app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers: authRequestHeaders(
          mismatched.id,
          mismatchContext.cookie,
          mismatchContext.ip,
        ),
        body: JSON.stringify({ email: otherEmail, type: "sign-in" }),
      },
    );
    expect(otpSent.status).toBe(200);
    const refused = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers: authRequestHeaders(
          mismatched.id,
          mismatchContext.cookie,
          mismatchContext.ip,
        ),
        body: JSON.stringify({ email: otherEmail, otp: providerState.otp }),
      },
    );
    expect(refused.status).not.toBe(200);
    expect(await userRows(otherEmail)).toHaveLength(0);
    expect((await world.rowOf(mismatched.id))?.status).toBe("pending");
  });

  it("accepts a magic-link callback only through its fixed invitation return path", async () => {
    await configureCustomerProvider("magic-link");
    const invited = await world.invite("magic.invitee@example.test");
    vi.restoreAllMocks();
    const { cookie, ip } = await beginContinuation(invited);
    const origin = CUSTOMER_ORIGIN();
    const sent = await world.app.request(
      `${origin}/api/auth/sign-in/magic-link`,
      {
        method: "POST",
        headers: authRequestHeaders(invited.id, cookie, ip),
        body: JSON.stringify({
          email: invited.email,
          callbackURL: `/invite/${invited.id}`,
        }),
      },
    );
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(providerState.magicLink).toBeTruthy();
    const link = new URL(providerState.magicLink as string, origin);
    expect(link.searchParams.get("callbackURL")).toBe(`/invite/${invited.id}`);
    const verified = await world.app.request(
      `${origin}${link.pathname}${link.search}`,
      {
        headers: authRequestHeaders(invited.id, cookie, ip),
        redirect: "manual",
      },
    );
    expect(verified.status).toBe(302);
    expect((await world.rowOf(invited.id))?.status).toBe("accepted");
    const [user] = await userRows(invited.email);
    expect(user).toMatchObject({ emailVerified: true, role: null });
    const { person, grants } = await acceptedCustomerGrants(user?.id as string);
    expect(person).toMatchObject({
      side: "customer",
      organisationId: world.org.id,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]?.sourceKind).toBe("direct");
  });

  it("uses verified customer OIDC claims, refuses wrong tenant or unverified email, and adds no JIT grants", async () => {
    const inviteEmail = "provider.invitee@example.test";
    providerState.oidcEmail = inviteEmail;
    await seedCustomerConnection(world.org.id);
    const invited = await world.invite(inviteEmail);
    vi.restoreAllMocks();
    const { callback } = await completeCustomerOidc(invited);
    expect(callback.status).toBe(302);
    expect(
      new URL(callback.headers.get("location") ?? "", CUSTOMER_ORIGIN()).href,
    ).toBe(new URL("/catalogue", CUSTOMER_ORIGIN()).href);
    expect((await world.rowOf(invited.id))?.status).toBe("accepted");
    const [user] = await userRows(inviteEmail);
    expect(user).toMatchObject({ emailVerified: true, role: null });
    const { person, grants } = await acceptedCustomerGrants(user?.id as string);
    expect(person).toMatchObject({
      side: "customer",
      organisationId: world.org.id,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      scope: "organisation",
      scopeId: world.org.id,
      sourceKind: "direct",
      identityConnectionId: null,
      externalIdentityId: null,
    });
    expect(
      grants.some((grant) =>
        ["jit_default", "oidc_group"].includes(grant.sourceKind),
      ),
    ).toBe(false);

    const unverified = await world.invite("unverified.provider@example.test");
    providerState.oidcEmail = unverified.email;
    providerState.emailVerified = false;
    vi.restoreAllMocks();
    const unverifiedResult = await completeCustomerOidc(unverified);
    expect(unverifiedResult.callback.status).toBe(302);
    expect((await world.rowOf(unverified.id))?.status).toBe("pending");
    expect(await userRows(unverified.email)).toHaveLength(0);

    const wrongTenant = await world.invite(
      "wrong.tenant.provider@example.test",
    );
    providerState.oidcEmail = wrongTenant.email;
    providerState.emailVerified = true;
    providerState.tenantId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    vi.restoreAllMocks();
    const tenantResult = await completeCustomerOidc(wrongTenant);
    expect(tenantResult.callback.status).toBe(302);
    expect((await world.rowOf(wrongTenant.id))?.status).toBe("pending");
    expect(await userRows(wrongTenant.email)).toHaveLength(0);
  });

  it("serializes concurrent consumers of one browser continuation", async () => {
    const invited = await world.invite("concurrent.provider@example.test");
    vi.restoreAllMocks();
    const { cookie } = await beginContinuation(invited);
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: `provider-concurrent-${crypto.randomUUID()}`,
        name: "Concurrent Provider",
        email: invited.email,
        emailVerified: true,
      })
      .returning();
    expect(user).toBeTruthy();
    const nonce = cookieValue(cookie);
    expect(nonce).toBeTruthy();
    const results = await Promise.allSettled([
      acceptCustomerInvitationFromContinuation({
        userId: user?.id as string,
        invitationId: invited.id,
        nonce: nonce as string,
      }),
      acceptCustomerInvitationFromContinuation({
        userId: user?.id as string,
        invitationId: invited.id,
        nonce: nonce as string,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await world.rowOf(invited.id))?.status).toBe("accepted");
    const { person, grants } = await acceptedCustomerGrants(user?.id as string);
    expect(person).toMatchObject({
      side: "customer",
      organisationId: world.org.id,
    });
    expect(grants).toHaveLength(1);
  });
});
