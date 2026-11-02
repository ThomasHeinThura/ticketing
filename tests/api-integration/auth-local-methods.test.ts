import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
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
const PASSWORD = "auth-local-methods-password";
const PATH = "/api/instance/auth/local-methods";
const PLUGIN_IDS = ["auth.password", "auth.magic-link", "auth.email-otp"];
type App = ReturnType<typeof createApp>["app"];
type Methods = { password: boolean; magicLink: boolean; emailOtp: boolean };
type Body = { agent: Methods; customer: Methods };
type RevisedBody = Body & { expectedRevision: string };
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

function passwordSignIn(app: App, portal: "agent" | "customer", email: string) {
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
  return "expectedRevision" in body
    ? body
    : { ...body, expectedRevision: await currentRevision(app, cookie) };
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
    const link = new URL(mailbox.magicLink as string, origin);
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
