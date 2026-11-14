import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auth,
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  portalAuth,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import acceptInvitation from "../../apps/api/src/invitation/controllers/accept-invitation";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import { nextClientIp } from "./helpers/organization-http";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "./helpers/step-up";

/**
 * S6: God Mode local sign-in methods. `PUT /api/instance/auth/local-methods` is instance-admin
 * only, elevated (PA-15 `auth_local_methods_update`) and session-only; staff password can never
 * be disabled (R5); the write is audited without values and reloads the portal auth instance.
 */

/** The last sign-in code and magic link handed to the mailer, as a customer would receive them. */
const mailbox = vi.hoisted(() => ({
  otp: null as string | null,
  magicLink: null as string | null,
}));

vi.mock("@taskdesk/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mocks/email")>();
  return {
    ...actual,
    sendOtpEmail: async (_to: string, _subject: string, data: unknown) => {
      mailbox.otp =
        typeof data === "object" && data !== null && "otp" in data
          ? String(data.otp)
          : null;
    },
    sendMagicLinkEmail: async (
      _to: string,
      _subject: string,
      data: unknown,
    ) => {
      mailbox.magicLink =
        typeof data === "object" && data !== null && "magicLink" in data
          ? String(data.magicLink)
          : null;
    },
  };
});

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const { base32 } = apiRequire("@better-auth/utils/base32") as {
  base32: { decode(value: string): Uint8Array };
};
const { createOTP } = apiRequire("@better-auth/utils/otp") as {
  createOTP(secret: string): { totp(): Promise<string> };
};
const PASSWORD = "auth-local-methods-password";
const PATH = "/api/instance/auth/local-methods";
const PLUGIN_IDS = ["auth.password", "auth.magic-link", "auth.email-otp"];
type App = ReturnType<typeof createApp>["app"];
type Methods = { password: boolean; magicLink: boolean; emailOtp: boolean };
type Body = { agent: Methods; customer: Methods };
type RevisedBody = Body & {
  expectedRevision: string;
  staffSelfRegistrationEnabled: boolean;
};
const ZERO_REVISION = "0".repeat(64);

const STAFF_ALL: Methods = { password: true, magicLink: true, emailOtp: true };
const CUSTOMER_OFF: Methods = {
  password: false,
  magicLink: false,
  emailOtp: false,
};

beforeEach(async () => {
  mailbox.otp = null;
  mailbox.magicLink = null;
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
  await reloadAuthConfiguration();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function makeStaffUser(id: string, role: string | null) {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: `User ${id}`, email: `${id}@example.test`, role })
    .returning();
  if (!user) throw new Error("user fixture");
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return user;
}

async function makeCustomerUser() {
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: randomUUID(),
        name: "Portal customer",
        email: `${randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning(),
    "user",
  );
  const org = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: randomUUID(),
        name: "Customer org",
        isInternal: false,
        active: true,
        portalAccess: true,
      })
      .returning(),
    "org",
  );
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: user.id,
        organisationId: org.id,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "person",
  );
  await db
    .insert(schema.roleTable)
    .values({
      scope: BUILT_IN_ROLES.customer.scope,
      workspaceId: null,
      key: BUILT_IN_ROLES.customer.key,
      name: "Customer",
      rank: BUILT_IN_ROLES.customer.rank,
      capabilities: [...BUILT_IN_ROLES.customer.capabilities],
      isSystem: true,
      isEditable: false,
    })
    .onConflictDoNothing();
  const role = requireRow(
    await db
      .select()
      .from(schema.roleTable)
      .where(eq(schema.roleTable.key, BUILT_IN_ROLES.customer.key)),
    "role",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "organisation",
    scopeId: org.id,
    roleId: role.id,
    seesAll: false,
  });
  await db.insert(schema.accountTable).values({
    id: randomUUID(),
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return user;
}

async function passwordSignIn(
  app: App,
  portal: "agent" | "customer",
  email: string,
) {
  const origin =
    portal === "agent"
      ? getConfiguredAgentOrigin()
      : getConfiguredCustomerOrigin();
  return app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

async function staffSession(app: App, email: string) {
  const login = await passwordSignIn(app, "agent", email);
  expect(login.status, await login.clone().text()).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  return cookie as string;
}

function readMethods(app: App, cookie: string) {
  return app.request(PATH, { headers: { cookie } });
}

/** The revision a caller would have read; a non-administrator cannot read one. */
async function currentRevision(app: App, cookie: string) {
  const response = await readMethods(app, cookie);
  if (response.status !== 200) return ZERO_REVISION;
  return ((await response.json()) as { revision: string }).revision;
}

async function withRevision(
  app: App,
  cookie: string,
  body: Body | RevisedBody,
): Promise<RevisedBody> {
  return {
    staffSelfRegistrationEnabled: false,
    ...body,
    expectedRevision:
      "expectedRevision" in body
        ? body.expectedRevision
        : await currentRevision(app, cookie),
  };
}

async function putMethods(
  app: App,
  cookie: string,
  body: Body | RevisedBody,
  headers: Record<string, string> = {},
) {
  const payload = await withRevision(app, cookie, body);
  return csrfRequest(
    app,
    PATH,
    {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, ...headers },
      body: JSON.stringify(payload),
    },
    cookie,
  );
}

async function putWithProof(
  app: App,
  cookie: string,
  body: Body | RevisedBody,
) {
  const payload = await withRevision(app, cookie, body);
  const token = await mintStepUpToken(
    app,
    cookie,
    "auth_local_methods_update",
    payload,
    PASSWORD,
  );
  expect(token).not.toBeNull();
  return putMethods(app, cookie, payload, {
    [STEP_UP_TOKEN_HEADER]: token as string,
  });
}

/** A JSON request to the customer host, as the portal sign-in page sends it. */
function customerAuthRequest(app: App, path: string, body: unknown) {
  const origin = getConfiguredCustomerOrigin();
  return app.request(`${origin}${path}`, {
    method: "POST",
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify(body),
  });
}

function hasPortalSession(response: Response) {
  return response.headers
    .getSetCookie()
    .some((value) => value.startsWith("__Host-tdk_portal_session="));
}

function portalAuthMethods(app: App) {
  const origin = getConfiguredCustomerOrigin();
  return app.request(`${origin}/api/portal/auth-methods`, {
    headers: { host: new URL(origin).host },
  });
}

async function storedRows() {
  return db
    .select({
      pluginId: schema.instancePluginConfigTable.pluginId,
      instanceKey: schema.instancePluginConfigTable.instanceKey,
      portalScope: schema.instancePluginConfigTable.portalScope,
      enabled: schema.instancePluginConfigTable.enabled,
    })
    .from(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PLUGIN_IDS));
}

async function auditRows() {
  return db
    .select({
      actorId: schema.auditLogTable.actorId,
      after: schema.auditLogTable.after,
    })
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "plugin.changed"),
        eq(schema.auditLogTable.entityId, "auth.local-methods"),
      ),
    );
}

describe("GET/PUT /api/instance/auth/local-methods (S6)", () => {
  it("requires an invitation for password signup even when the environment forces registration off", async () => {
    const inviter = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.instanceSettingTable)
      .set({ staffSelfRegistrationEnabled: true })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    await reloadAuthConfiguration();
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const { app } = createApp();
    const origin = getConfiguredAgentOrigin();
    const signup = (email: string, invitationId?: string) =>
      app.request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({
          email,
          password: PASSWORD,
          name: "Invited staff",
          invitationId,
        }),
      });
    const stranger = `${randomUUID()}@example.test`;
    expect((await signup(stranger)).status).toBe(403);
    const email = `${randomUUID()}@example.test`;
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (!invitation) throw new Error("invitation fixture");
    const admitted = await signup(email, invitation.id);
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    if (!user) throw new Error("invited user not created");
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    expect(person?.side).toBe("staff");
  });

  it.each(["email-otp", "magic-link"] as const)(
    "requires a staff invitation for %s account creation",
    async (method) => {
      const inviter = await createWorkspaceMember({ role: "owner" });
      const { app } = createApp();
      const origin = getConfiguredAgentOrigin();
      const post = (path: string, body: unknown) =>
        app.request(`${origin}${path}`, {
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            "content-type": "application/json",
            "x-forwarded-for": nextClientIp(),
          },
          body: JSON.stringify(body),
        });
      const attempt = async (email: string) => {
        if (method === "email-otp") {
          mailbox.otp = null;
          const sent = await post("/api/auth/email-otp/send-verification-otp", {
            email,
            type: "sign-in",
          });
          expect(sent.status).toBe(200);
          expect(mailbox.otp).toBeTruthy();
          return post("/api/auth/sign-in/email-otp", {
            email,
            otp: mailbox.otp,
          });
        }
        mailbox.magicLink = null;
        const sent = await post("/api/auth/sign-in/magic-link", {
          email,
          callbackURL: "/dashboard",
        });
        expect(sent.status).toBe(200);
        expect(mailbox.magicLink).toBeTruthy();
        const link = new URL(String(mailbox.magicLink), origin);
        return app.request(`${origin}${link.pathname}${link.search}`, {
          headers: {
            host: new URL(origin).host,
            "x-forwarded-for": nextClientIp(),
          },
          redirect: "manual",
        });
      };
      const stranger = `${randomUUID()}@example.test`;
      await attempt(stranger);
      expect(
        await db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.email, stranger)),
      ).toHaveLength(0);
      const email = `${randomUUID()}@example.test`;
      await db.insert(schema.invitationTable).values({
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await attempt(email);
      const [user] = await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.email, email));
      if (!user) throw new Error("invited user not created");
      const [person] = await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.id));
      expect(person?.side).toBe("staff");
    },
  );

  it("creates the staff identity atomically when a previously provisioned user accepts", async () => {
    const inviter = await createWorkspaceMember({ role: "owner" });
    const email = `${randomUUID()}@example.test`;
    const [user] = await db
      .insert(schema.userTable)
      .values({ id: randomUUID(), email, name: "Invitee" })
      .returning();
    if (!user) throw new Error("user fixture");
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (!invitation) throw new Error("invitation fixture");
    await acceptInvitation(invitation.id, user.id);
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    expect(person?.side).toBe("staff");
  });

  it("does not create a staff identity for an expired invitation", async () => {
    const inviter = await createWorkspaceMember({ role: "owner" });
    const email = `${randomUUID()}@example.test`;
    const [user] = await db
      .insert(schema.userTable)
      .values({ id: randomUUID(), email, name: "Invitee" })
      .returning();
    if (!user) throw new Error("user fixture");
    const [invitation] = await db
      .insert(schema.invitationTable)
      .values({
        workspaceId: inviter.workspace.id,
        inviterId: inviter.user.id,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    if (!invitation) throw new Error("invitation fixture");
    await expect(acceptInvitation(invitation.id, user.id)).rejects.toThrow();
    expect(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.id)),
    ).toHaveLength(0);
  });

  it("denies a non-administrator on read and write", async () => {
    await makeStaffUser("local-methods-plain", null);
    const { app } = createApp();
    const cookie = await staffSession(app, "local-methods-plain@example.test");

    const read = await readMethods(app, cookie);
    expect([403, 404]).toContain(read.status);
    expect(
      await mintStepUpToken(
        app,
        cookie,
        "auth_local_methods_update",
        {
          agent: STAFF_ALL,
          customer: STAFF_ALL,
          expectedRevision: ZERO_REVISION,
          staffSelfRegistrationEnabled: false,
        },
        PASSWORD,
      ),
    ).toBeNull();
    const write = await putMethods(
      app,
      cookie,
      { agent: STAFF_ALL, customer: STAFF_ALL },
      { [STEP_UP_TOKEN_HEADER]: "A".repeat(43) },
    );
    expect([403, 404]).toContain(write.status);
    expect(await write.text()).not.toContain("step_up");
    expect(await storedRows()).toHaveLength(0);
  });

  it("reads the runtime defaults when nothing is stored", async () => {
    await makeStaffUser("local-methods-admin-read", "admin");
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-read@example.test",
    );
    const response = await readMethods(app, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Body & {
      emailProviderEnabled: boolean;
      emailOtpDisabledByEnvironment: boolean;
    };
    expect(body.agent.password).toBe(true);
    expect(body.customer).toEqual(CUSTOMER_OFF);
    expect(typeof body.emailProviderEnabled).toBe("boolean");
    expect(typeof body.emailOtpDisabledByEnvironment).toBe("boolean");
  });

  it("requires step-up to change staff registration and audits old and new values", async () => {
    await makeStaffUser("registration-admin", "admin");
    const { app } = createApp();
    const cookie = await staffSession(app, "registration-admin@example.test");
    const base = { agent: STAFF_ALL, customer: CUSTOMER_OFF };
    const revision = await currentRevision(app, cookie);
    const requested = {
      ...base,
      expectedRevision: revision,
      staffSelfRegistrationEnabled: true,
    };
    const refused = await putMethods(app, cookie, requested);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("Enroll a second factor");
    const unchanged = {
      ...requested,
      customer: { ...CUSTOMER_OFF, password: true },
      staffSelfRegistrationEnabled: false,
    };
    const unchangedProof = await mintStepUpToken(
      app,
      cookie,
      "auth_local_methods_update",
      unchanged,
      PASSWORD,
    );
    expect(unchangedProof).not.toBeNull();
    const unchangedSave = await putMethods(app, cookie, unchanged, {
      [STEP_UP_TOKEN_HEADER]: unchangedProof as string,
    });
    expect(unchangedSave.status, await unchangedSave.clone().text()).toBe(200);
    requested.expectedRevision = await currentRevision(app, cookie);
    for (const method of ["password", "sso_prompt_login"] as const) {
      const challenge = await csrfRequest(
        app,
        "/api/me/step-up/challenges",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            kind: "operation",
            operation: "auth_local_methods_update",
            ...requested,
          }),
        },
        cookie,
      );
      expect(challenge.status).toBe(200);
      const { challengeId, nonce } = (await challenge.json()) as {
        challengeId: string;
        nonce: string;
      };
      const proof = await csrfRequest(
        app,
        "/api/me/step-up",
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            kind: "operation",
            operation: "auth_local_methods_update",
            ...requested,
            challengeId,
            nonce,
            method,
            ...(method === "password" ? { password: PASSWORD } : {}),
          }),
        },
        cookie,
      );
      expect(proof.status, await proof.clone().text()).toBe(403);
      expect(await proof.text()).toContain("Enroll a second factor");
    }
    const enabled = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie,
        origin: getConfiguredAgentOrigin(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: PASSWORD, issuer: "TaskDesk" }),
    });
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get("secret");
    if (!secret) throw new Error("missing TOTP secret");
    const rawSecret = Buffer.from(base32.decode(secret)).toString("utf8");
    const enrolled = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie,
        origin: getConfiguredAgentOrigin(),
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({ code: await createOTP(rawSecret).totp() }),
    });
    expect(enrolled.status).toBe(200);
    const enrolledCookie = enrolled.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-tdk_agent_session="))
      ?.split(";", 1)[0];
    if (!enrolledCookie) throw new Error("missing enrolled session");
    const challenge = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { cookie: enrolledCookie, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "auth_local_methods_update",
          ...requested,
        }),
      },
      enrolledCookie,
    );
    expect(challenge.status).toBe(200);
    const { challengeId, nonce } = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const passwordAfterEnrollment = await csrfRequest(
      app,
      "/api/me/step-up",
      {
        method: "POST",
        headers: { cookie: enrolledCookie, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "auth_local_methods_update",
          ...requested,
          challengeId,
          nonce,
          method: "password",
          password: PASSWORD,
        }),
      },
      enrolledCookie,
    );
    expect(passwordAfterEnrollment.status).toBe(403);
    expect(await passwordAfterEnrollment.text()).toContain(
      "Use a second factor",
    );
    const proof = await csrfRequest(
      app,
      "/api/me/step-up",
      {
        method: "POST",
        headers: { cookie: enrolledCookie, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "auth_local_methods_update",
          ...requested,
          challengeId,
          nonce,
          method: "totp",
          code: await createOTP(rawSecret).totp(),
        }),
      },
      enrolledCookie,
    );
    expect(proof.status, await proof.clone().text()).toBe(200);
    const { token } = (await proof.json()) as { token: string };
    const response = await putMethods(app, enrolledCookie, requested, {
      [STEP_UP_TOKEN_HEADER]: token,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const stored = await db
      .select({
        enabled: schema.instanceSettingTable.staffSelfRegistrationEnabled,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(stored[0]?.enabled).toBe(true);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        eq(schema.auditLogTable.entityId, "staff_self_registration_enabled"),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.before).toEqual({ enabled: false });
    expect(audits[0]?.after).toEqual({ enabled: true });
  });

  it("refuses to disable staff password with 422 before spending a proof", async () => {
    await makeStaffUser("local-methods-admin-422", "admin");
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-422@example.test",
    );
    const body = {
      agent: { ...STAFF_ALL, password: false },
      customer: CUSTOMER_OFF,
    };
    const response = await putMethods(app, cookie, body);
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("agent_password_required");
    expect(await storedRows()).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it("requires a fresh proof bound to the exact request", async () => {
    await makeStaffUser("local-methods-admin-proof", "admin");
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-proof@example.test",
    );
    const body = {
      agent: STAFF_ALL,
      customer: { ...CUSTOMER_OFF, password: true },
    };
    const missing = await putMethods(app, cookie, body);
    expect(missing.status).toBe(403);
    expect(await missing.text()).toContain("step_up_required");

    const other = await mintStepUpToken(
      app,
      cookie,
      "auth_local_methods_update",
      await withRevision(app, cookie, {
        agent: STAFF_ALL,
        customer: STAFF_ALL,
      }),
      PASSWORD,
    );
    expect(other).not.toBeNull();
    const mismatched = await putMethods(app, cookie, body, {
      [STEP_UP_TOKEN_HEADER]: other as string,
    });
    expect(mismatched.status).toBe(403);
    expect(await mismatched.text()).toContain("step_up_unavailable");
    expect(await storedRows()).toHaveLength(0);
  });

  it("enables customer password sign-in, audits keys only, and the portal follows", async () => {
    await makeStaffUser("local-methods-admin-ok", "admin");
    const customer = await makeCustomerUser();
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-ok@example.test",
    );

    // Customer password is off by default: the portal does not admit it.
    expect(await (await portalAuthMethods(app)).json()).toEqual(CUSTOMER_OFF);
    const refused = await passwordSignIn(app, "customer", customer.email);
    expect(refused.status).not.toBe(200);

    const enable = {
      agent: STAFF_ALL,
      customer: { ...CUSTOMER_OFF, password: true },
    };
    const response = await putWithProof(app, cookie, enable);
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = (await response.json()) as Body;
    expect(saved.customer).toEqual(enable.customer);
    expect(saved.agent).toEqual(STAFF_ALL);

    // One canonical row per method and portal.
    const rows = await storedRows();
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.instanceKey).toBe(row.portalScope);

    // Audited once, with the changed keys only, never a value.
    const audits = await auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe("local-methods-admin-ok");
    expect(audits[0]?.after).toMatchObject({
      changedKeys: ["customer.password"],
      retiredRows: 0,
    });

    expect(await (await portalAuthMethods(app)).json()).toEqual(
      enable.customer,
    );
    const admitted = await passwordSignIn(app, "customer", customer.email);
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    expect(
      admitted.headers
        .getSetCookie()
        .some((value) => value.startsWith("__Host-tdk_portal_session=")),
    ).toBe(true);

    // Repeating the same state changes nothing and writes no audit row.
    const repeat = await putWithProof(app, cookie, enable);
    expect(repeat.status).toBe(200);
    expect(await auditRows()).toHaveLength(1);

    // Turning it off closes the portal door again; staff password still works.
    const disable = { agent: STAFF_ALL, customer: CUSTOMER_OFF };
    const off = await putWithProof(app, cookie, disable);
    expect(off.status).toBe(200);
    expect(await (await portalAuthMethods(app)).json()).toEqual(CUSTOMER_OFF);
    const closed = await passwordSignIn(app, "customer", customer.email);
    expect(closed.status).not.toBe(200);
    const staff = await passwordSignIn(
      app,
      "agent",
      "local-methods-admin-ok@example.test",
    );
    expect(staff.status).toBe(200);
  });

  it("lets a customer sign in by email code and magic link while enabled, and hides both when disabled", async () => {
    await makeStaffUser("local-methods-admin-email", "admin");
    const customer = await makeCustomerUser();
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-email@example.test",
    );
    const origin = getConfiguredCustomerOrigin();

    const emailMethods = { password: false, magicLink: true, emailOtp: true };
    const enabled = await putWithProof(app, cookie, {
      agent: STAFF_ALL,
      customer: emailMethods,
    });
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    // The portal sign-in page reads this to show the email-code and magic-link actions.
    expect(await (await portalAuthMethods(app)).json()).toEqual(emailMethods);

    // Email code: send, then sign in with the code from the mail.
    const sent = await customerAuthRequest(
      app,
      "/api/auth/email-otp/send-verification-otp",
      { email: customer.email, type: "sign-in" },
    );
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(mailbox.otp).toBeTruthy();
    const otpSignIn = await customerAuthRequest(
      app,
      "/api/auth/sign-in/email-otp",
      { email: customer.email, otp: mailbox.otp },
    );
    expect(otpSignIn.status, await otpSignIn.clone().text()).toBe(200);
    expect(hasPortalSession(otpSignIn)).toBe(true);

    // Magic link: send, then open the link from the mail.
    const linkSent = await customerAuthRequest(
      app,
      "/api/auth/sign-in/magic-link",
      { email: customer.email, callbackURL: "/catalogue" },
    );
    expect(linkSent.status, await linkSent.clone().text()).toBe(200);
    expect(mailbox.magicLink).toBeTruthy();
    const link = new URL(String(mailbox.magicLink), origin);
    const verified = await app.request(
      `${origin}${link.pathname}${link.search}`,
      {
        headers: {
          host: new URL(origin).host,
          "x-forwarded-for": nextClientIp(),
        },
        redirect: "manual",
      },
    );
    expect(verified.status, await verified.clone().text()).toBe(302);
    expect(hasPortalSession(verified)).toBe(true);

    // Switched off: the portal stops offering both and the host refuses their endpoints.
    const disabled = await putWithProof(app, cookie, {
      agent: STAFF_ALL,
      customer: CUSTOMER_OFF,
    });
    expect(disabled.status).toBe(200);
    expect(await (await portalAuthMethods(app)).json()).toEqual(CUSTOMER_OFF);
    mailbox.otp = null;
    mailbox.magicLink = null;
    const otpRefused = await customerAuthRequest(
      app,
      "/api/auth/email-otp/send-verification-otp",
      { email: customer.email, type: "sign-in" },
    );
    expect(otpRefused.status).not.toBe(200);
    const linkRefused = await customerAuthRequest(
      app,
      "/api/auth/sign-in/magic-link",
      { email: customer.email, callbackURL: "/catalogue" },
    );
    expect(linkRefused.status).not.toBe(200);
    expect(mailbox.otp).toBeNull();
    expect(mailbox.magicLink).toBeNull();
  });

  it("retires an existing 'both' row without duplicates or lockout", async () => {
    await makeStaffUser("local-methods-admin-legacy", "admin");
    const customer = await makeCustomerUser();
    // An install that enabled password for both portals by hand.
    await db.insert(schema.instancePluginConfigTable).values({
      id: randomUUID(),
      pluginId: "auth.password",
      instanceKey: "default",
      displayName: "Password",
      enabled: true,
      config: {},
      scope: "instance",
      portalScope: "both",
      configVersion: 1,
    });
    await reloadAuthConfiguration();
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-legacy@example.test",
    );

    const read = (await (await readMethods(app, cookie)).json()) as Body;
    expect(read.customer.password).toBe(true);
    expect(read.agent.password).toBe(true);
    expect((await passwordSignIn(app, "customer", customer.email)).status).toBe(
      200,
    );

    const response = await putWithProof(app, cookie, {
      agent: STAFF_ALL,
      customer: CUSTOMER_OFF,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(((await response.json()) as Body).customer).toEqual(CUSTOMER_OFF);

    const rows = await storedRows();
    // Six canonical rows plus the retained, now disabled, legacy row.
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.instanceKey === "default")).toEqual([
      {
        pluginId: "auth.password",
        instanceKey: "default",
        portalScope: "both",
        enabled: false,
      },
    ]);
    expect(
      rows.filter(
        (row) =>
          row.pluginId === "auth.password" && row.instanceKey === "agent",
      ),
    ).toEqual([
      {
        pluginId: "auth.password",
        instanceKey: "agent",
        portalScope: "agent",
        enabled: true,
      },
    ]);
    const audits = await auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({
      changedKeys: ["customer.password"],
      retiredRows: 1,
    });

    expect(await (await portalAuthMethods(app)).json()).toEqual(CUSTOMER_OFF);
    expect(
      (await passwordSignIn(app, "customer", customer.email)).status,
    ).not.toBe(200);
    expect(
      (
        await passwordSignIn(
          app,
          "agent",
          "local-methods-admin-legacy@example.test",
        )
      ).status,
    ).toBe(200);
  });
  it("refuses a save made against a stale revision with 409 and burns no proof", async () => {
    await makeStaffUser("local-methods-admin-stale", "admin");
    const { app } = createApp();
    const cookie = await staffSession(
      app,
      "local-methods-admin-stale@example.test",
    );
    const staleRevision = await currentRevision(app, cookie);
    // Another administrator saves first.
    const first = await putWithProof(app, cookie, {
      agent: STAFF_ALL,
      customer: { ...CUSTOMER_OFF, password: true },
    });
    expect(first.status).toBe(200);
    expect(await auditRows()).toHaveLength(1);

    const stale = {
      agent: STAFF_ALL,
      customer: CUSTOMER_OFF,
      expectedRevision: staleRevision,
      staffSelfRegistrationEnabled: false,
    };
    const token = await mintStepUpToken(
      app,
      cookie,
      "auth_local_methods_update",
      stale,
      PASSWORD,
    );
    expect(token).not.toBeNull();
    const response = await putMethods(app, cookie, stale, {
      [STEP_UP_TOKEN_HEADER]: token as string,
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("version_conflict");
    expect(await (await portalAuthMethods(app)).json()).toEqual({
      ...CUSTOMER_OFF,
      password: true,
    });
    expect(await auditRows()).toHaveLength(1);
    // Minting cleared the first save's spent proof; the refused save spent nothing, so the
    // one remaining proof is still unspent.
    const proofs = await db
      .select({ state: schema.stepUpConfirmationTable.state })
      .from(schema.stepUpConfirmationTable)
      .where(
        eq(
          schema.stepUpConfirmationTable.operationKey,
          "auth_local_methods_update",
        ),
      );
    expect(proofs).toEqual([{ state: "issued" }]);
  });
  it("keeps staff password reachable when staff email code is off on an instance with SMTP", async () => {
    // Bootstrap SMTP: the staff sign-in page would show the send-code form while email code is on.
    vi.stubEnv("SMTP_HOST", "bootstrap.example.test");
    vi.stubEnv("SMTP_FROM", "sender@example.test");
    const staff = await makeStaffUser("local-methods-admin-staff-otp", "admin");
    const { app } = createApp();
    const cookie = await staffSession(app, staff.email);
    const agentOrigin = getConfiguredAgentOrigin();
    const staffConfig = async () =>
      (await (
        await app.request(`${agentOrigin}/api/config`, {
          headers: { host: new URL(agentOrigin).host },
        })
      ).json()) as { hasSmtp: boolean; disableEmailOtpSignIn: boolean };
    const sendStaffCode = () =>
      app.request(`${agentOrigin}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: {
          host: new URL(agentOrigin).host,
          origin: agentOrigin,
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({ email: staff.email, type: "sign-in" }),
      });
    expect(await staffConfig()).toMatchObject({
      hasSmtp: true,
      disableEmailOtpSignIn: false,
    });

    const off = await putWithProof(app, cookie, {
      agent: { ...STAFF_ALL, emailOtp: false },
      customer: CUSTOMER_OFF,
    });
    expect(off.status, await off.clone().text()).toBe(200);
    // The staff sign-in page reads this and shows the password form, not the send-code form.
    expect(await staffConfig()).toMatchObject({
      hasSmtp: true,
      disableEmailOtpSignIn: true,
    });
    expect((await sendStaffCode()).status).toBe(404);
    expect((await passwordSignIn(app, "agent", staff.email)).status).toBe(200);

    const on = await putWithProof(app, cookie, {
      agent: STAFF_ALL,
      customer: CUSTOMER_OFF,
    });
    expect(on.status, await on.clone().text()).toBe(200);
    expect(await staffConfig()).toMatchObject({ disableEmailOtpSignIn: false });
  });
});

describe("signed-in portal password change", () => {
  it("requires a customer session, checks the old password, and updates only its caller", async () => {
    await makeStaffUser("password-change-admin", "admin");
    const customer = await makeCustomerUser();
    const other = await makeCustomerUser();
    const { app } = createApp();
    const agentCookie = await staffSession(
      app,
      "password-change-admin@example.test",
    );
    const enabled = await putWithProof(app, agentCookie, {
      agent: STAFF_ALL,
      customer: { ...CUSTOMER_OFF, password: true },
    });
    expect(enabled.status).toBe(200);
    const login = await passwordSignIn(app, "customer", customer.email);
    expect(login.status).toBe(200);
    const portalCookie = login.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Host-tdk_portal_session="))
      ?.split(";", 1)[0];
    expect(portalCookie).toBeDefined();
    const origin = getConfiguredCustomerOrigin();
    const change = (cookie: string | undefined, currentPassword: string) =>
      app.request(`${origin}/api/auth/change-password`, {
        method: "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({
          currentPassword,
          newPassword: "replacement-password-42",
          revokeOtherSessions: false,
          userId: other.id,
        }),
      });
    expect((await change(undefined, PASSWORD)).status).toBe(401);
    expect((await change(agentCookie, PASSWORD)).status).toBe(401);
    expect(
      (
        await change(
          agentCookie.replace(
            "__Host-tdk_agent_session=",
            "__Host-tdk_portal_session=",
          ),
          PASSWORD,
        )
      ).status,
    ).toBe(401);
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.userTable.id, customer.id));
    const status = await app.request(`${origin}/api/me/security/factors`, {
      headers: { host: new URL(origin).host, cookie: portalCookie as string },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      enabled: true,
      hasLocalPassword: true,
      passwordRequiredForEnrollment: false,
    });
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: false })
      .where(eq(schema.userTable.id, customer.id));
    const call = (
      body: Record<string, unknown>,
      requestOrigin = origin,
      method = "POST",
      path = "/api/auth/change-password",
    ) =>
      app.request(`${origin}${path}`, {
        method,
        headers: {
          host: new URL(origin).host,
          origin: requestOrigin,
          "content-type": "application/json",
          cookie: portalCookie as string,
          "x-forwarded-for": nextClientIp(),
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      });
    const originalAccounts = await db
      .select()
      .from(schema.accountTable)
      .where(inArray(schema.accountTable.userId, [customer.id, other.id]));
    const originalSessions = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, customer.id));
    const valid = {
      currentPassword: PASSWORD,
      newPassword: "replacement-password-42",
      revokeOtherSessions: true,
    };
    expect((await call({ newPassword: valid.newPassword })).status).toBe(400);
    expect((await call({ ...valid, newPassword: "short" })).status).toBe(400);
    expect(
      (await call({ ...valid, newPassword: "x".repeat(129) })).status,
    ).toBe(400);
    expect((await call(valid, "https://untrusted.example")).status).toBe(403);
    expect((await call(valid, origin, "GET")).status).not.toBe(200);
    expect(
      (await call(valid, origin, "POST", "/api/auth/update-user")).status,
    ).toBe(404);
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: null })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect((await call(valid)).status).toBe(403);
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: new Date() })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const ownAccount = originalAccounts.find(
      (account) => account.userId === customer.id,
    );
    if (!ownAccount) throw new Error("customer account fixture missing");
    await db
      .delete(schema.accountTable)
      .where(eq(schema.accountTable.id, ownAccount.id));
    expect((await call(valid)).status).toBe(400);
    await db.insert(schema.accountTable).values(ownAccount);
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.userTable.id, customer.id));
    const pending = await passwordSignIn(app, "customer", customer.email);
    expect(await pending.clone().json()).toMatchObject({
      twoFactorRedirect: true,
    });
    const pendingCookies = pending.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";", 1)[0])
      .join("; ");
    expect((await change(pendingCookies, PASSWORD)).status).toBe(401);
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: false })
      .where(eq(schema.userTable.id, customer.id));
    const afterDenials = await db
      .select()
      .from(schema.accountTable)
      .where(inArray(schema.accountTable.userId, [customer.id, other.id]));
    expect(
      afterDenials
        .map(({ id, password }) => ({ id, password }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      originalAccounts
        .map(({ id, password }) => ({ id, password }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(
      (
        await db
          .select()
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, customer.id))
      ).map((session) => session.id),
    ).toEqual(originalSessions.map((session) => session.id));
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "auth.password_changed"),
            eq(schema.auditLogTable.actorId, customer.id),
          ),
        ),
    ).toHaveLength(0);
    const wrong = await change(portalCookie, "incorrect-password");
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).code).toBe("INVALID_PASSWORD");
    const success = await change(portalCookie, PASSWORD);
    expect(success.status, await success.clone().text()).toBe(200);
    const accounts = await db
      .select()
      .from(schema.accountTable)
      .where(inArray(schema.accountTable.userId, [customer.id, other.id]));
    const compare = apiRequire("bcryptjs") as {
      compare(value: string, hash: string): Promise<boolean>;
    };
    const own = accounts.find((account) => account.userId === customer.id);
    const untouched = accounts.find((account) => account.userId === other.id);
    expect(
      await compare.compare("replacement-password-42", own?.password ?? ""),
    ).toBe(true);
    expect(await compare.compare(PASSWORD, untouched?.password ?? "")).toBe(
      true,
    );
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "auth.password_changed"),
          eq(schema.auditLogTable.actorId, customer.id),
        ),
      );
    expect(audit).toHaveLength(1);

    const peerLogin = await app.request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        host: new URL(origin).host,
        origin,
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({
        email: customer.email,
        password: "replacement-password-42",
      }),
    });
    expect(peerLogin.status).toBe(200);
    const sessionsBefore = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, customer.id));
    expect(sessionsBefore.length).toBeGreaterThanOrEqual(2);
    const revoked = await app.request(`${origin}/api/auth/change-password`, {
      method: "POST",
      headers: {
        host: new URL(origin).host,
        origin,
        "content-type": "application/json",
        cookie: portalCookie as string,
      },
      body: JSON.stringify({
        currentPassword: "replacement-password-42",
        newPassword: "another-password-42",
        revokeOtherSessions: true,
      }),
    });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const sessionsAfter = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, customer.id));
    expect(sessionsAfter).toHaveLength(1);
    expect(
      sessionsBefore.some((session) => session.id === sessionsAfter[0]?.id),
    ).toBe(false);
    expect(sessionsAfter[0]?.portal).toBe("customer");
  });
});

describe.each(["agent", "customer"] as const)(
  "%s MFA password rotation",
  (surface) => {
    it("keeps the verified replacement session and revokes the verified peer", async () => {
      await makeStaffUser("mfa-rotation-admin", "admin");
      const user =
        surface === "agent"
          ? await makeStaffUser("mfa-rotation-user", null)
          : await makeCustomerUser();
      const { app } = createApp();
      if (surface === "customer") {
        const adminCookie = await staffSession(
          app,
          "mfa-rotation-admin@example.test",
        );
        expect(
          (
            await putWithProof(app, adminCookie, {
              agent: STAFF_ALL,
              customer: { ...CUSTOMER_OFF, password: true },
            })
          ).status,
        ).toBe(200);
      }
      const origin =
        surface === "agent"
          ? getConfiguredAgentOrigin()
          : getConfiguredCustomerOrigin();
      const cookieName =
        surface === "agent"
          ? "__Host-tdk_agent_session="
          : "__Host-tdk_portal_session=";
      const extract = (response: Response, name: string) =>
        response.headers
          .getSetCookie()
          .find((value) => value.startsWith(name))
          ?.split(";", 1)[0];
      const login = await passwordSignIn(app, surface, user.email);
      const initial = extract(login, cookieName);
      if (!initial) throw new Error("initial session missing");
      const instance = surface === "agent" ? auth : portalAuth;
      // Customer enrollment is fixture setup through the auth provider; the portal host intentionally does not expose that route.
      const enrollmentResponse = await instance.handler(
        new Request(`${origin}/api/auth/two-factor/enable`, {
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            cookie: initial,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: PASSWORD, issuer: "TaskDesk" }),
        }),
      );
      expect(enrollmentResponse.status).toBe(200);
      const enrollment = (await enrollmentResponse.json()) as {
        totpURI: string;
        backupCodes: string[];
      };
      const secret = new URL(enrollment.totpURI).searchParams.get("secret");
      if (!secret) throw new Error("TOTP secret missing");
      const verified = await app.request(
        `${origin}/api/auth/two-factor/verify-totp`,
        {
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            cookie: initial,
            "content-type": "application/json",
            "x-forwarded-for": nextClientIp(),
          },
          body: JSON.stringify({
            code: await createOTP(
              Buffer.from(base32.decode(secret)).toString("utf8"),
            ).totp(),
          }),
        },
      );
      expect(verified.status, await verified.clone().text()).toBe(200);
      const current = extract(verified, cookieName);
      if (!current) throw new Error("verified session missing");
      const pending = await passwordSignIn(app, surface, user.email);
      expect(await pending.clone().json()).toMatchObject({
        twoFactorRedirect: true,
      });
      const challenge = extract(pending, "better-auth.two_factor=");
      if (!challenge) throw new Error("factor challenge missing");
      const peerResponse = await app.request(
        `${origin}/api/auth/two-factor/verify-backup-code`,
        {
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            cookie: challenge,
            "content-type": "application/json",
            "x-forwarded-for": nextClientIp(),
          },
          body: JSON.stringify({ code: enrollment.backupCodes[0] }),
        },
      );
      expect(peerResponse.status).toBe(200);
      const peer = extract(peerResponse, cookieName);
      if (!peer) throw new Error("verified peer missing");
      if (surface === "agent") {
        const currentSessionResponse = await app.request(
          `${origin}/api/auth/get-session`,
          { headers: { host: new URL(origin).host, cookie: current } },
        );
        const currentSession = (await currentSessionResponse.json()) as {
          session: { id: string };
        };
        const [person] = await db
          .select()
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, user.id));
        if (!person) throw new Error("agent person missing");
        const now = new Date();
        await db.insert(schema.stepUpConfirmationTable).values({
          id: "password-rotation-step-up",
          personId: person.id,
          sessionId: currentSession.session.id,
          bindingKind: "operation",
          operationKey: "metrics_token_rotate",
          routeKey: "POST /api/instance/observability/metrics-token/rotate",
          expectedVersion: 1,
          bodyHash: Buffer.alloc(32, 1),
          challengeNonceHash: Buffer.alloc(32, 2),
          state: "issued",
          tokenHash: Buffer.alloc(32, 3),
          authMethod: "totp",
          authenticatedAt: now,
          issuedAt: now,
          challengeExpiresAt: new Date(now.getTime() + 300_000),
          tokenExpiresAt: new Date(now.getTime() + 300_000),
        });
      }
      const change = await app.request(`${origin}/api/auth/change-password`, {
        method: "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          cookie: current,
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({
          currentPassword: PASSWORD,
          newPassword: "rotation-verified-password",
          revokeOtherSessions: true,
        }),
      });
      expect(change.status, await change.clone().text()).toBe(200);
      const replacement = extract(change, cookieName);
      if (!replacement) throw new Error("replacement session missing");
      const sessionFor = (cookie: string) =>
        app.request(`${origin}/api/auth/get-session`, {
          headers: { host: new URL(origin).host, cookie },
        });
      expect(await (await sessionFor(replacement)).json()).toMatchObject({
        user: { id: user.id },
      });
      expect(await (await sessionFor(current)).json()).toBeNull();
      expect(await (await sessionFor(peer)).json()).toBeNull();
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "auth.password_changed"),
            eq(schema.auditLogTable.actorId, user.id),
          ),
        );
      expect(audit).toHaveLength(1);
      if (surface === "agent") {
        expect(
          await db
            .select()
            .from(schema.stepUpConfirmationTable)
            .where(
              eq(
                schema.stepUpConfirmationTable.id,
                "password-rotation-step-up",
              ),
            ),
        ).toHaveLength(0);
      }
    });
  },
);

describe("password-change rate limit", () => {
  it("limits repeated malformed credential requests without changing the account", async () => {
    const user = await makeStaffUser("password-rate-user", null);
    const { app } = createApp();
    const cookie = await staffSession(app, user.email);
    const origin = getConfiguredAgentOrigin();
    const ip = nextClientIp();
    const before = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, user.id));
    const sessions = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id));
    const crossSite = await app.request(`${origin}/api/auth/change-password`, {
      method: "POST",
      headers: {
        host: new URL(origin).host,
        origin: "https://untrusted.example",
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({
        currentPassword: PASSWORD,
        newPassword: "valid-password",
        revokeOtherSessions: true,
      }),
    });
    expect(crossSite.status).toBe(403);
    let limited = false;
    for (let attempt = 0; attempt < 105; attempt += 1) {
      const response = await app.request(`${origin}/api/auth/change-password`, {
        method: "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          cookie,
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ newPassword: "valid-password" }),
      });
      if (response.status === 429) {
        limited = true;
        break;
      }
      expect(response.status).toBe(400);
    }
    expect(limited).toBe(true);
    expect(
      (
        await db
          .select()
          .from(schema.accountTable)
          .where(eq(schema.accountTable.userId, user.id))
      )[0]?.password,
    ).toBe(before[0]?.password);
    expect(
      (
        await db
          .select()
          .from(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, user.id))
      ).map((row) => row.id),
    ).toEqual(sessions.map((row) => row.id));
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "auth.password_changed"),
            eq(schema.auditLogTable.actorId, user.id),
          ),
        ),
    ).toHaveLength(0);
  });
});
