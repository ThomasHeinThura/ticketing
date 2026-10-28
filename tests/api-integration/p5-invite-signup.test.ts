/**
 * Invitation-gated sign-up on the portal host (CP-12, CP-24). A new invitee signs up with the
 * emailed credential; the same request consumes the invitation through the locked accept
 * transaction and creates the customer person and membership, so the session that comes back is a
 * working customer-portal session. Everything else stays refused: no credential, another address,
 * an expired, revoked, used or staff-scope invitation, the agent host, and a closed provider.
 *
 * These tests use the real Better Auth handler and real cookies (no session mock).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";
import {
  type InviteWorld,
  inviteWorld,
  PORTAL_HOST,
} from "./helpers/p5-invite";
import { emailMock, sentWorkspaceInvitationEmails } from "./mocks/email";

const acceptService = vi.hoisted(() => ({ failNext: false }));
vi.mock("../../apps/api/src/customer-invitation/service", async (original) => {
  const actual =
    await original<
      typeof import("../../apps/api/src/customer-invitation/service")
    >();
  return {
    ...actual,
    acceptCustomerInvitation: (
      ...args: Parameters<typeof actual.acceptCustomerInvitation>
    ) => {
      if (acceptService.failNext) {
        acceptService.failNext = false;
        return Promise.reject(new Error("lost the race"));
      }
      return actual.acceptCustomerInvitation(...args);
    },
  };
});

const PASSWORD = "A-long-enough-portal-password-1";
const customerOrigin = () => getConfiguredCustomerOrigin();
const agentOrigin = () => getConfiguredAgentOrigin();
const PORTAL_COOKIE = "__Host-tdk_portal_session";

let w: InviteWorld;

async function setCustomerPassword(enabled: boolean) {
  await db
    .delete(schema.instancePluginConfigTable)
    .where(eq(schema.instancePluginConfigTable.pluginId, "auth.password"));
  if (enabled)
    await db.insert(schema.instancePluginConfigTable).values({
      id: crypto.randomUUID(),
      pluginId: "auth.password",
      instanceKey: "invite-signup-customer-password",
      displayName: "Invite sign-up customer password",
      enabled: true,
      config: {},
      scope: "instance",
      portalScope: "customer",
      configVersion: Date.now() % 1_000_000,
    });
  await reloadAuthConfiguration();
}

beforeEach(async () => {
  await resetTestDatabase();
  emailMock.configured = true;
  sentWorkspaceInvitationEmails.length = 0;
  acceptService.failNext = false;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton" })
    .onConflictDoNothing();
  w = await inviteWorld();
  await setCustomerPassword(true);
});

afterAll(async () => {
  await setCustomerPassword(false);
});

type SignUpBody = Record<string, unknown>;

/** A real sign-up request with no session mock; each call is a distinct client for the limiter. */
async function signUp(
  body: SignUpBody,
  options: { origin?: string; ip?: string } = {},
) {
  vi.restoreAllMocks();
  const target = options.origin ?? customerOrigin();
  return w.app.request(`${target}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      host: new URL(target).host,
      origin: target,
      "content-type": "application/json",
      "x-forwarded-for": options.ip ?? nextClientIp(),
    },
    body: JSON.stringify(body),
  });
}

function bodyFor(
  invited: { id: string; credential: string },
  email: string,
  extra: SignUpBody = {},
): SignUpBody {
  return {
    name: "New Invitee",
    email,
    password: PASSWORD,
    invitationId: invited.id,
    invitationCredential: invited.credential,
    ...extra,
  };
}

async function beginContinuation(
  invited: { id: string; credential: string },
  ip = nextClientIp(),
) {
  const target = customerOrigin();
  const response = await w.app.request(
    `${target}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation`,
    {
      method: "POST",
      headers: {
        host: new URL(target).host,
        origin: target,
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ credential: invited.credential }),
    },
  );
  return {
    response,
    cookie: cookieOf(response, `__Host-tdk_customer_invite_${invited.id}`),
    ip,
  };
}

const cookieOf = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";", 1)[0];

async function userRows(email: string) {
  return db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));
}

async function personsOf(userId: string) {
  return db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId));
}

async function membershipsOf(personId: string) {
  return db
    .select()
    .from(schema.membershipTable)
    .where(eq(schema.membershipTable.personId, personId));
}

async function sessionsFor(userId: string) {
  return db
    .select()
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, userId));
}

async function deniedRows() {
  const rows = await db
    .select({ id: schema.auditLogTable.id })
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.action, "permission.denied"));
  return rows.length;
}

async function auditReasons(invitationId: string) {
  const rows = await db
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.entityType, "invitation"),
        eq(schema.auditLogTable.entityId, invitationId),
      ),
    );
  return rows.map((row) => ({
    action: row.action,
    after: row.after as Record<string, unknown> | null,
  }));
}

function expectNoLiveSessionCookie(response: Response) {
  const set = cookieOf(response, PORTAL_COOKIE);
  expect(set === undefined || /^[^=]+=$/.test(set)).toBe(true);
}

/** Nothing was created or consumed: no user, no session, no customer identity, still pending. */
async function expectUntouched(
  invited: { id: string },
  email: string,
  response: Response,
) {
  expectNoLiveSessionCookie(response);
  expect(await userRows(email)).toHaveLength(0);
  const row = await w.rowOf(invited.id);
  expect(row?.status).toBe("pending");
  expect(row?.credentialHash).not.toBeNull();
}

describe("a new invitee signs up with the credential", () => {
  it("rejects a continuation POST from a foreign origin before looking up the invitation", async () => {
    const invited = await w.invite("foreign.origin@example.test");
    const target = customerOrigin();
    const response = await w.app.request(
      `${target}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation`,
      {
        method: "POST",
        headers: {
          host: new URL(target).host,
          origin: "https://attacker.example.test",
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({ credential: invited.credential }),
      },
    );

    expect(response.status, await response.clone().text()).toBe(403);
    expect(await w.rowOf(invited.id)).toMatchObject({ status: "pending" });
    expect(
      await db
        .select()
        .from(schema.customerInvitationAuthContinuationTable)
        .where(
          eq(
            schema.customerInvitationAuthContinuationTable.invitationId,
            invited.id,
          ),
        ),
    ).toHaveLength(0);
  });

  it("hands the fragment to the continuation endpoint before a provider signup", async () => {
    const email = "continuation.invitee@example.test";
    const invited = await w.invite(email);
    const { response: begun, cookie, ip } = await beginContinuation(invited);
    expect(begun.status, await begun.clone().text()).toBe(204);
    expect(cookie).toBeTruthy();
    const setCookie = begun.headers.getSetCookie().join(";");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    // inviteWorld.invite() uses a staff-authenticated route and leaves its session spy active.
    // Restore the real auth getter before testing the anonymous customer signup request.
    vi.restoreAllMocks();
    const response = await w.app.request(
      `${customerOrigin()}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: {
          host: new URL(customerOrigin()).host,
          origin: customerOrigin(),
          "content-type": "application/json",
          cookie: cookie as string,
          "x-taskdesk-invitation-id": invited.id,
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({
          invitationId: invited.id,
          name: "New Invitee",
          email,
          password: PASSWORD,
        }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).not.toContain(invited.credential);
    const [user] = await userRows(email);
    expect(user?.emailVerified).toBe(true);
    expect((await w.rowOf(invited.id))?.status).toBe("accepted");
    const [continuation] = await db
      .select()
      .from(schema.customerInvitationAuthContinuationTable)
      .where(
        eq(
          schema.customerInvitationAuthContinuationTable.invitationId,
          invited.id,
        ),
      );
    expect(continuation?.consumedAt).toBeInstanceOf(Date);
    expect(continuation?.acceptedUserId).toBe(user?.id);
    expect(continuation?.nonceHash).not.toBe(cookie?.split("=")[1]);
    expect(JSON.stringify(continuation)).not.toContain(invited.credential);

    const sessionCookie = cookieOf(response, PORTAL_COOKIE);
    const result = await w.app.request(
      `${customerOrigin()}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation-result`,
      {
        headers: {
          host: new URL(customerOrigin()).host,
          origin: customerOrigin(),
          cookie: `${sessionCookie}; ${cookie}`,
        },
      },
    );
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toEqual({ accepted: true });
    expect(result.headers.getSetCookie().join(";")).toContain("Max-Age=0");
  });

  it("signs up, accepts in the same request and gets a working customer session that cannot reach the agent host", async () => {
    const email = "fresh.invitee@example.test";
    const invited = await w.invite(email);
    const response = await signUp(bodyFor(invited, email));
    expect(response.status, await response.clone().text()).toBe(200);
    const cookie = cookieOf(response, PORTAL_COOKIE);
    expect(cookie).toBeTruthy();
    // The credential is neither echoed nor stored.
    expect(await response.text()).not.toContain(invited.credential);

    const [user] = await userRows(email);
    expect(user?.emailVerified).toBe(true);
    expect(user?.role ?? null).toBeNull();
    const persons = await personsOf(user?.id as string);
    expect(persons).toHaveLength(1);
    expect(persons[0]).toMatchObject({
      side: "customer",
      organisationId: w.org.id,
      active: true,
    });
    expect(await membershipsOf(persons[0]?.id as string)).toHaveLength(1);
    const row = await w.rowOf(invited.id);
    expect(row).toMatchObject({
      status: "accepted",
      credentialHash: null,
      acceptedPersonId: persons[0]?.id,
    });
    const audit = await auditReasons(invited.id);
    expect(audit).toContainEqual({
      action: "invitation.redeemed",
      after: { scope: "customer", via: "sign_up" },
    });
    expect(JSON.stringify(audit)).not.toContain(invited.credential);
    expect(JSON.stringify(audit)).not.toContain(email);

    const portalSession = await w.app.request(
      `${customerOrigin()}/api/auth/get-session`,
      { headers: { host: PORTAL_HOST, cookie: cookie as string } },
    );
    expect(portalSession.status).toBe(200);
    expect(
      ((await portalSession.json()) as { user?: { email?: string } } | null)
        ?.user?.email,
    ).toBe(email);
    const csrf = await w.app.request(
      `${customerOrigin()}/api/portal/csrf-token`,
      {
        headers: {
          host: PORTAL_HOST,
          origin: customerOrigin(),
          cookie: cookie as string,
        },
      },
    );
    expect(csrf.status, await csrf.clone().text()).toBe(200);

    // The same cookie opens nothing on the agent host.
    const agentHost = new URL(agentOrigin()).host;
    const agentSession = await w.app.request(
      `${agentOrigin()}/api/auth/get-session`,
      { headers: { host: agentHost, cookie: cookie as string } },
    );
    expect(await agentSession.text()).toBe("null");
    const agentApi = await w.app.request(`${agentOrigin()}/api/me/csrf-token`, {
      headers: { host: agentHost, cookie: cookie as string },
    });
    expect(agentApi.status).toBeGreaterThanOrEqual(401);
  });

  it("matches the address case-insensitively and ignores extra body fields (no role, no staff person)", async () => {
    const email = "mixed.case@example.test";
    const invited = await w.invite(email);
    const response = await signUp(
      bodyFor(invited, "Mixed.Case@Example.test", {
        role: "admin",
        organisationId: w.otherOrg.id,
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const [user] = await userRows(email);
    expect(user?.role ?? null).toBeNull();
    const persons = await personsOf(user?.id as string);
    expect(persons).toHaveLength(1);
    expect(persons[0]?.side).toBe("customer");
    expect(persons[0]?.organisationId).toBe(w.org.id);
    const memberships = await membershipsOf(persons[0]?.id as string);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.scopeId).toBe(w.org.id);
  });
});

describe("every other sign-up on the portal host stays refused", () => {
  it("refuses a request with no credential and writes no audit row (no log noise)", async () => {
    const email = "no.credential@example.test";
    const invited = await w.invite(email);
    const response = await signUp({
      name: "x",
      email,
      password: PASSWORD,
      invitationId: invited.id,
    });
    expect(response.status).toBe(403);
    await expectUntouched(invited, email, response);
    expect(
      (await auditReasons(invited.id)).filter(
        (row) => row.action === "permission.denied",
      ),
    ).toEqual([]);
  });

  it("refuses a request with neither field, or an unknown invitation, and audits nothing", async () => {
    const email = "bare@example.test";
    const before = await deniedRows();
    const response = await signUp({ name: "x", email, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(await userRows(email)).toHaveLength(0);
    const unknown = await signUp({
      name: "x",
      email,
      password: PASSWORD,
      invitationId: "does-not-exist",
      invitationCredential: "C".repeat(43),
    });
    expect(unknown.status).toBe(403);
    expect(await userRows(email)).toHaveLength(0);
    expect(await deniedRows()).toBe(before);
  });

  it("refuses another address and a wrong credential with the same generic answer", async () => {
    const email = "invited.only@example.test";
    const invited = await w.invite(email);
    const wrongEmail = await signUp(
      bodyFor(invited, "someone.else@example.test"),
    );
    const wrongCredential = await signUp(
      bodyFor({ id: invited.id, credential: "B".repeat(43) }, email),
    );
    expect(wrongEmail.status).toBe(403);
    expect(wrongCredential.status).toBe(403);
    expect(await wrongEmail.text()).toBe(await wrongCredential.text());
    await expectUntouched(invited, email, wrongCredential);
    expect(await userRows("someone.else@example.test")).toHaveLength(0);
    const reasons = (await auditReasons(invited.id)).map(
      (a) => a.after?.reason,
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        "signup_address_mismatch",
        "signup_credential_mismatch",
      ]),
    );
  });

  it("refuses an expired invitation", async () => {
    const email = "late@example.test";
    const invited = await w.invite(email);
    await db
      .update(schema.invitationTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.invitationTable.id, invited.id));
    const response = await signUp(bodyFor(invited, email));
    expect(response.status).toBe(403);
    expect(await userRows(email)).toHaveLength(0);
  });

  it("refuses a revoked invitation", async () => {
    const email = "revoked@example.test";
    const invited = await w.invite(email);
    await db
      .update(schema.invitationTable)
      .set({ status: "canceled" })
      .where(eq(schema.invitationTable.id, invited.id));
    const response = await signUp(bodyFor(invited, email));
    expect(response.status).toBe(403);
    expect(await userRows(email)).toHaveLength(0);
  });

  it("refuses a resent invitation's old credential", async () => {
    const email = "resent@example.test";
    const invited = await w.invite(email);
    await db
      .update(schema.invitationTable)
      .set({ lastSentAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.invitationTable.id, invited.id));
    const resent = await w.call(
      w.owner.user,
      `${w.base()}/${invited.id}/resend`,
      { method: "POST" },
    );
    expect(resent.status).toBe(200);
    const response = await signUp(bodyFor(invited, email));
    expect(response.status).toBe(403);
    expect(await userRows(email)).toHaveLength(0);
  });

  it("refuses a used credential: the invitation is single use", async () => {
    const email = "once@example.test";
    const invited = await w.invite(email);
    expect((await signUp(bodyFor(invited, email))).status).toBe(200);
    const again = await signUp(bodyFor(invited, email));
    expect(again.status).toBe(403);
    expect(await userRows(email)).toHaveLength(1);
    const [user] = await userRows(email);
    const persons = await personsOf(user?.id as string);
    expect(await membershipsOf(persons[0]?.id as string)).toHaveLength(1);
  });

  it("refuses a staff-scope invitation (it carries no customer credential)", async () => {
    const email = "staffscope@example.test";
    const [staff] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: w.workspaceId,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 3_600_000),
        inviterId: w.owner.user.id,
        scope: "staff",
      })
      .returning();
    for (const credential of ["C".repeat(43), "x".repeat(16)]) {
      const response = await signUp(
        bodyFor({ id: staff?.id as string, credential }, email),
      );
      expect(response.status).toBe(403);
      expect(await userRows(email)).toHaveLength(0);
    }
    expect((await w.rowOf(staff?.id as string))?.status).toBe("pending");
    const reasons = (await auditReasons(staff?.id as string)).map(
      (a) => a.after?.reason,
    );
    expect(reasons).toContain("signup_scope_mismatch");
  });

  it("is not reachable on the portal host while the customer password provider is off", async () => {
    const email = "closed@example.test";
    const invited = await w.invite(email);
    await setCustomerPassword(false);
    const response = await signUp(bodyFor(invited, email));
    expect(response.status).toBe(404);
    expect(await userRows(email)).toHaveLength(0);
    expect((await w.rowOf(invited.id))?.status).toBe("pending");
  });

  it("never consumes or honours a customer credential on the agent host", async () => {
    const email = "agent.host@example.test";
    const invited = await w.invite(email);
    const response = await signUp(bodyFor(invited, email), {
      origin: agentOrigin(),
    });
    // The agent host applies its own registration rules (a staff sign-up) and never the
    // customer invitation: it is not consumed and no customer identity exists.
    expect((await w.rowOf(invited.id))?.status).toBe("pending");
    expect(cookieOf(response, PORTAL_COOKIE)).toBeUndefined();
    const [user] = await userRows(email);
    if (user) {
      const persons = await personsOf(user.id);
      expect(persons.every((person) => person.side !== "customer")).toBe(true);
    }
    const customerMemberships = await db
      .select()
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.scopeId, w.org.id));
    expect(customerMemberships).toHaveLength(0);
  });
});

describe("sign-up that cannot complete accept leaves nothing usable", () => {
  it("removes the new account and session when accept loses, then lets a retry succeed", async () => {
    const email = "retry@example.test";
    const invited = await w.invite(email);
    acceptService.failNext = true;
    const failed = await signUp(bodyFor(invited, email));
    expect(failed.status).toBe(403);
    expectNoLiveSessionCookie(failed);
    expect(await userRows(email)).toHaveLength(0);
    expect((await w.rowOf(invited.id))?.status).toBe("pending");

    const retried = await signUp(bodyFor(invited, email));
    expect(retried.status, await retried.clone().text()).toBe(200);
    const [user] = await userRows(email);
    expect(await sessionsFor(user?.id as string)).toHaveLength(1);
    expect((await w.rowOf(invited.id))?.status).toBe("accepted");
  });
});

describe("single use under concurrency", () => {
  it("lets exactly one of two simultaneous sign-ups with the same credential through", async () => {
    const email = "race@example.test";
    const invited = await w.invite(email);
    const results = await Promise.all([
      signUp(bodyFor(invited, email)),
      signUp(bodyFor(invited, email)),
      signUp(bodyFor(invited, email)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s < 500)).toBe(true);
    const users = await userRows(email);
    expect(users).toHaveLength(1);
    const persons = await personsOf(users[0]?.id as string);
    expect(persons).toHaveLength(1);
    expect(await membershipsOf(persons[0]?.id as string)).toHaveLength(1);
    expect(await sessionsFor(users[0]?.id as string)).toHaveLength(1);
    const redeemed = (await auditReasons(invited.id)).filter(
      (a) => a.action === "invitation.redeemed",
    );
    expect(redeemed).toHaveLength(1);
  });
});

describe("rate limit", () => {
  it("applies the configured anonymous ceiling before validating invitation credentials", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitWindowMs: 60_000, anonymousRateLimitMax: 1 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const ip = nextClientIp();
    const body = {
      name: "Unknown invitee",
      email: "unknown@example.test",
      password: PASSWORD,
      invitationId: "does-not-exist",
      invitationCredential: "A-credential-that-is-long-enough",
    };
    const first = await signUp(body, { ip });
    const second = await signUp(body, { ip });
    expect(first.status).toBe(403);
    expect(second.status).toBe(429);
  });

  it("answers 429 after three sign-up attempts a minute from one client", async () => {
    const email = "limited@example.test";
    const invited = await w.invite(email);
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await signUp(bodyFor(invited, "wrong@example.test"), { ip })).status,
      );
    expect(statuses.slice(0, 3)).toEqual([403, 403, 403]);
    expect(statuses[3]).toBe(429);
    expect((await w.rowOf(invited.id))?.status).toBe("pending");
  });
});
