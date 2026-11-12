import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import {
  hashResetIdentifier,
  signResetToken,
} from "../../apps/api/src/auth/password-reset";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { nextClientIp } from "./helpers/organization-http";
import {
  createCustomerUser,
  ensureCustomerRole,
  insertOrganisation,
} from "./helpers/p5-invite";
import { emailMock, sentPasswordResetEmails } from "./mocks/email";

/**
 * A-05: a password sign-in on the wrong host answers 403 with a code naming the right door. It
 * never answers 200, never echoes a token or the profile, leaves no live session and audits the
 * refusal (P3-R1-01, P3-R1-08).
 */
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PORTAL_HOST = "portal.localhost:5174";
const AGENT_ORIGIN = "http://localhost:1337";
const PROVIDER_IDS = ["auth.password"];

type Door = "portal" | "agent";

let appInstance: ReturnType<typeof createApp>["app"] | null = null;
function sharedApp() {
  appInstance ??= createApp().app;
  return appInstance;
}

function base(door: Door) {
  return door === "portal" ? getConfiguredCustomerOrigin() : AGENT_ORIGIN;
}

async function passwordSignIn(door: Door, email: string, password: string) {
  return sharedApp().request(`${base(door)}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      host: door === "portal" ? PORTAL_HOST : new URL(AGENT_ORIGIN).host,
      origin: base(door),
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ email, password }),
  });
}

async function withPassword(userId: string) {
  const password = randomUUID();
  await db.insert(schema.accountTable).values({
    id: `${userId}-credential`,
    accountId: userId,
    providerId: "credential",
    userId,
    password: await bcrypt.hash(password, 4),
  });
  return password;
}

async function sessionCount(userId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, userId));
  return row?.value ?? 0;
}

async function refusalAudits(userId: string, reason: string) {
  const rows = await db
    .select({ after: schema.auditLogTable.after })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "permission.denied"),
        eq(schema.auditLogTable.entityId, userId),
      ),
    );
  return rows.filter(
    (row) => (row.after as { reason?: string } | null)?.reason === reason,
  );
}

async function admittedCustomer(options: { active?: boolean } = {}) {
  const org = await insertOrganisation("Wrong Door Org");
  const { user, personId } = await createCustomerUser({
    organisationId: org.id,
    person: true,
  });
  await grantCustomerOrganisationMembership(org.id, personId as string);
  if (options.active === false)
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, personId as string));
  return { user, password: await withPassword(user.id) };
}

async function staffUser() {
  const member = await createWorkspaceMember({ role: "member" });
  return { user: member.user, password: await withPassword(member.user.id) };
}

async function expectRefused(
  response: Response,
  userId: string,
  code: string,
  auditReason: string,
) {
  const text = await response.text();
  expect(response.status, text).toBe(403);
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(body.code).toBe(code);
  expect(body).not.toHaveProperty("token");
  expect(body).not.toHaveProperty("user");
  expect(text).not.toContain(userId);
  expect(response.headers.getSetCookie().join(";")).not.toMatch(
    /session_token=[^;]+(?<!=);/u,
  );
  expect(await sessionCount(userId)).toBe(0);
  expect(await refusalAudits(userId, auditReason)).toHaveLength(1);
}

beforeEach(async () => {
  sentPasswordResetEmails.length = 0;
  emailMock.failTransport = false;
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton" })
    .onConflictDoNothing();
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.customer_portal", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await db.insert(schema.instancePluginConfigTable).values({
    id: randomUUID(),
    pluginId: "auth.password",
    instanceKey: "a05-password",
    displayName: "A-05 password",
    enabled: true,
    config: {},
    scope: "instance",
    workspaceId: null,
    portalScope: "both",
    configVersion: 1,
  });
  await reloadAuthConfiguration();
  await ensureCustomerRole();
  vi.restoreAllMocks();
});

afterAll(async () => {
  emailMock.failTransport = false;
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await reloadAuthConfiguration();
});

describe("A-05 password sign-in on the wrong host", () => {
  it("refuses a customer on the agent host and names the customer portal", async () => {
    const { user, password } = await admittedCustomer();
    await expectRefused(
      await passwordSignIn("agent", user.email, password),
      user.id,
      "USE_CUSTOMER_PORTAL",
      "customer_on_agent_host",
    );
  });

  it("refuses a staff member on the portal host and names the agent sign-in", async () => {
    const { user, password } = await staffUser();
    await expectRefused(
      await passwordSignIn("portal", user.email, password),
      user.id,
      "USE_AGENT_SIGN_IN",
      "customer_identity_unavailable",
    );
  });

  it("refuses a deactivated customer on the portal without pointing at the agent host", async () => {
    const { user, password } = await admittedCustomer({ active: false });
    await expectRefused(
      await passwordSignIn("portal", user.email, password),
      user.id,
      "CUSTOMER_PORTAL_UNAVAILABLE",
      "customer_identity_unavailable",
    );
  });

  it("still signs each person in on their own host", async () => {
    const customer = await admittedCustomer();
    const onPortal = await passwordSignIn(
      "portal",
      customer.user.email,
      customer.password,
    );
    expect(onPortal.status, await onPortal.clone().text()).toBe(200);
    expect(await sessionCount(customer.user.id)).toBe(1);

    const staff = await staffUser();
    const onAgent = await passwordSignIn(
      "agent",
      staff.user.email,
      staff.password,
    );
    expect(onAgent.status, await onAgent.clone().text()).toBe(200);
    expect(await sessionCount(staff.user.id)).toBe(1);
  });
});

describe("password recovery portal and credential boundaries", () => {
  function linkToken(link: URL) {
    expect(link.searchParams.has("token")).toBe(false);
    return new URLSearchParams(link.hash.slice(1)).get("token") ?? "";
  }
  async function requestReset(door: Door, email: string) {
    return sharedApp().request(
      `${base(door)}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          host: door === "portal" ? PORTAL_HOST : new URL(AGENT_ORIGIN).host,
          origin: base(door),
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({ email }),
      },
    );
  }
  async function complete(door: Door, token: string) {
    return sharedApp().request(`${base(door)}/api/auth/reset-password`, {
      method: "POST",
      headers: {
        host: door === "portal" ? PORTAL_HOST : new URL(AGENT_ORIGIN).host,
        origin: base(door),
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({ token, newPassword: "new-secure-password" }),
    });
  }
  async function insertToken(
    userId: string,
    portal: "agent" | "customer",
    expired = false,
  ) {
    const token = randomUUID();
    await db.insert(schema.verificationTable).values({
      identifier: await hashResetIdentifier(`reset-password:${token}`),
      value: userId,
      expiresAt: new Date(Date.now() + (expired ? -1000 : 3600000)),
    });
    return signResetToken(
      token,
      portal,
      process.env.TASKDESK_AUTH_SECRET as string,
    );
  }
  it("refuses the other portal, wrong account side, SSO-only, and expired tokens", async () => {
    const staff = await staffUser();
    const customer = await admittedCustomer();
    const staffToken = await insertToken(staff.user.id, "agent");
    const credentialBefore = await db
      .select({ password: schema.accountTable.password })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, staff.user.id));
    expect((await complete("portal", staffToken)).status).toBe(400);
    expect(
      (await complete("agent", await insertToken(customer.user.id, "agent")))
        .status,
    ).toBe(400);
    expect(
      (await complete("agent", await insertToken(staff.user.id, "agent", true)))
        .status,
    ).toBe(400);
    expect(
      await db
        .select({ password: schema.accountTable.password })
        .from(schema.accountTable)
        .where(eq(schema.accountTable.userId, staff.user.id)),
    ).toEqual(credentialBefore);
    await db
      .delete(schema.accountTable)
      .where(eq(schema.accountTable.userId, staff.user.id));
    expect((await complete("agent", staffToken)).status).toBe(400);
    await requestReset("agent", staff.user.email);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sentPasswordResetEmails).toHaveLength(0);
  });
  it("sends on the right host, revokes sessions and accepts the token only once", async () => {
    const staff = await staffUser();
    expect(
      (await passwordSignIn("agent", staff.user.email, staff.password)).status,
    ).toBe(200);
    expect((await requestReset("agent", staff.user.email)).status).toBe(200);
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(1));
    const message = sentPasswordResetEmails[0];
    if (!message) throw new Error("Reset email not delivered");
    const link = new URL(message.resetLink);
    expect(link.origin).toBe(new URL(getConfiguredAgentOrigin()).origin);
    const token = linkToken(link);
    expect((await complete("agent", token)).status).toBe(200);
    expect(await sessionCount(staff.user.id)).toBe(0);
    expect((await complete("agent", token)).status).toBe(400);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.password_reset_completed"));
    expect(audit).toHaveLength(1);
  });
  it("sends customer links only for customer requests on the portal host", async () => {
    const customer = await admittedCustomer();
    const staff = await staffUser();
    expect((await requestReset("agent", customer.user.email)).status).toBe(200);
    expect((await requestReset("portal", staff.user.email)).status).toBe(200);
    expect((await requestReset("portal", customer.user.email)).status).toBe(
      200,
    );
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(1));
    const message = sentPasswordResetEmails[0];
    if (!message) throw new Error("Reset email not delivered");
    const link = new URL(message.resetLink);
    expect(link.origin).toBe(new URL(getConfiguredCustomerOrigin()).origin);
    expect(link.pathname).toBe("/reset-password");
    expect((await complete("portal", linkToken(link))).status).toBe(200);
  });
  it("limits repeated requests for the same address across IPs", async () => {
    const staff = await staffUser();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await requestReset("agent", staff.user.email);
      expect(response.status).toBe(200);
    }
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(3));
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.password_reset_requested"));
    expect(audit).toHaveLength(4);
  });
  it("stores only digests and supersedes the earlier link on a newer request", async () => {
    const staff = await staffUser();
    await requestReset("agent", staff.user.email);
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(1));
    const first = new URL(sentPasswordResetEmails[0]?.resetLink ?? "");
    const earlier = linkToken(first);
    const raw = earlier.split(".")[0] ?? "";
    const rows = await db
      .select()
      .from(schema.verificationTable)
      .where(eq(schema.verificationTable.value, staff.user.id));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(raw);
    expect(JSON.stringify(rows)).not.toContain(earlier);
    expect(rows[0]?.identifier).toBe(
      await hashResetIdentifier(`reset-password:${raw}`),
    );
    await requestReset("agent", staff.user.email);
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(2));
    const newer = linkToken(
      new URL(sentPasswordResetEmails[1]?.resetLink ?? ""),
    );
    expect((await complete("agent", earlier)).status).toBe(400);
    expect((await complete("agent", newer)).status).toBe(200);
    expect((await complete("agent", earlier)).status).toBe(400);
    expect((await complete("agent", newer)).status).toBe(400);
  });
  it("allows only one concurrent reset completion", async () => {
    const staff = await staffUser();
    await requestReset("agent", staff.user.email);
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(1));
    const token = linkToken(
      new URL(sentPasswordResetEmails[0]?.resetLink ?? ""),
    );
    const results = await Promise.all([
      complete("agent", token),
      complete("agent", token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
  it("invalidates recovery links when the password changes", async () => {
    const staff = await staffUser();
    const login = await passwordSignIn(
      "agent",
      staff.user.email,
      staff.password,
    );
    const cookie = login.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-tdk_agent_session="))
      ?.split(";", 1)[0];
    if (!cookie) throw new Error("Session cookie missing");
    await requestReset("agent", staff.user.email);
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(1));
    const token = linkToken(
      new URL(sentPasswordResetEmails[0]?.resetLink ?? ""),
    );
    const change = await csrfRequest(
      sharedApp(),
      "/api/auth/change-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: staff.password,
          newPassword: "new-valid-password-42",
        }),
      },
      cookie,
    );
    expect(change.status).toBe(200);
    expect((await complete("agent", token)).status).toBe(400);
  });
  it("preserves MFA, ban and bootstrap state while revoking multiple sessions", async () => {
    const staff = await staffUser();
    const logins = await Promise.all([
      passwordSignIn("agent", staff.user.email, staff.password),
      passwordSignIn("agent", staff.user.email, staff.password),
    ]);
    const cookies = logins.map(
      (r) =>
        r.headers
          .getSetCookie()
          .find((v) => v.startsWith("__Host-tdk_agent_session="))
          ?.split(";", 1)[0],
    );
    expect(cookies.every(Boolean)).toBe(true);
    const [impersonated] = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, staff.user.id))
      .limit(1);
    if (!impersonated) throw new Error("Session missing");
    await db
      .update(schema.sessionTable)
      .set({ impersonatedBy: staff.user.id })
      .where(eq(schema.sessionTable.id, impersonated.id));
    await db.insert(schema.twoFactorTable).values({
      id: randomUUID(),
      userId: staff.user.id,
      secret: "encrypted-factor-fixture",
      backupCodes: "encrypted-backups-fixture",
      verified: true,
    });
    const factors = await db
      .select()
      .from(schema.twoFactorTable)
      .where(eq(schema.twoFactorTable.userId, staff.user.id));
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true, banned: true, banReason: "test" })
      .where(eq(schema.userTable.id, staff.user.id));
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: null })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const settings = await db
      .select({
        setupCompletedAt: schema.instanceSettingTable.setupCompletedAt,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const token = await insertToken(staff.user.id, "agent");
    expect((await complete("agent", token)).status).toBe(200);
    const [user] = await db
      .select({
        twoFactorEnabled: schema.userTable.twoFactorEnabled,
        banned: schema.userTable.banned,
        banReason: schema.userTable.banReason,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, staff.user.id));
    expect(user).toEqual({
      twoFactorEnabled: true,
      banned: true,
      banReason: "test",
    });
    expect(
      await db
        .select({
          setupCompletedAt: schema.instanceSettingTable.setupCompletedAt,
        })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton")),
    ).toEqual(settings);
    expect(await sessionCount(staff.user.id)).toBe(0);
    expect(
      await db
        .select()
        .from(schema.twoFactorTable)
        .where(eq(schema.twoFactorTable.userId, staff.user.id)),
    ).toEqual(factors);
    for (const cookie of cookies) {
      const response = await sharedApp().request(
        `${base("agent")}/api/auth/get-session`,
        { headers: { host: new URL(AGENT_ORIGIN).host, cookie: cookie ?? "" } },
      );
      expect(await response.json()).toBeNull();
    }
  });
  it("keeps MFA required at the next login", async () => {
    const staff = await staffUser();
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.userTable.id, staff.user.id));
    await db.insert(schema.twoFactorTable).values({
      id: randomUUID(),
      userId: staff.user.id,
      secret: "encrypted-factor-fixture",
      backupCodes: "encrypted-backups-fixture",
      verified: true,
    });
    const token = await insertToken(staff.user.id, "agent");
    expect((await complete("agent", token)).status).toBe(200);
    const login = await passwordSignIn(
      "agent",
      staff.user.email,
      "new-secure-password",
    );
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ twoFactorRedirect: true });
  });
  it("does not use an untrusted forwarded Host in recovery links", async () => {
    const staff = await staffUser();
    const response = await sharedApp().request(
      `${base("agent")}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          host: new URL(AGENT_ORIGIN).host,
          origin: base("agent"),
          "x-forwarded-host": "attacker.example",
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({ email: staff.user.email }),
      },
    );
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(sentPasswordResetEmails).toHaveLength(1));
    const url = new URL(sentPasswordResetEmails[0]?.resetLink ?? "");
    expect(url.origin).toBe(new URL(getConfiguredAgentOrigin()).origin);
  });
  it("answers identically for missing, passwordless, suspended and throttled addresses", async () => {
    const staff = await staffUser();
    const passwordless = await staffUser();
    const suspended = await staffUser();
    await db
      .delete(schema.accountTable)
      .where(eq(schema.accountTable.userId, passwordless.user.id));
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, suspended.user.id));
    const responses = [
      await requestReset("agent", staff.user.email),
      await requestReset("agent", `${randomUUID()}@example.test`),
      await requestReset("agent", passwordless.user.email),
      await requestReset("agent", suspended.user.email),
    ];
    for (let n = 0; n < 3; n++)
      responses.push(await requestReset("agent", staff.user.email));
    const values = await Promise.all(
      responses.map(async (r) => ({
        status: r.status,
        body: await r.json(),
        // Per-request tracing and wall-clock values are unrelated to account state.
        headers: [...r.headers.entries()]
          .filter(
            ([name]) =>
              ![
                "date",
                "x-request-id",
                "traceparent",
                "server-timing",
              ].includes(name),
          )
          .sort(([a], [b]) => a.localeCompare(b)),
        setCookie: r.headers.getSetCookie(),
      })),
    );
    for (const value of values) expect(value).toEqual(values[0]);
  });
  it("returns identical responses for missing users and failed mail", async () => {
    const staff = await staffUser();
    emailMock.failTransport = true;
    const present = await requestReset("agent", staff.user.email);
    const missing = await requestReset("agent", `${randomUUID()}@example.test`);
    expect(present.status).toBe(missing.status);
    expect(await present.json()).toEqual(await missing.json());
  });
});
