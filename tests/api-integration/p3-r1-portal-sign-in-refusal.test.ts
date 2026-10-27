import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { nextClientIp } from "./helpers/organization-http";
import {
  createCustomerUser,
  ensureCustomerRole,
  insertOrganisation,
} from "./helpers/p5-invite";
import { emailMock } from "./mocks/email";

const mailState = vi.hoisted(() => ({
  otp: null as string | null,
  magicLink: null as string | null,
}));
const acceptState = vi.hoisted(() => ({ fail: false }));

vi.mock("@taskdesk/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mocks/email")>();
  return {
    ...actual,
    sendOtpEmail: async (_to: string, _subject: string, data: unknown) => {
      mailState.otp =
        typeof data === "object" && data !== null && "otp" in data
          ? String(data.otp)
          : null;
    },
    sendMagicLinkEmail: async (
      _to: string,
      _subject: string,
      data: unknown,
    ) => {
      mailState.magicLink =
        typeof data === "object" && data !== null && "magicLink" in data
          ? String(data.magicLink)
          : null;
    },
  };
});

vi.mock("../../apps/api/src/customer-invitation/service", async (original) => {
  const actual =
    await original<
      typeof import("../../apps/api/src/customer-invitation/service")
    >();
  return {
    ...actual,
    acceptCustomerInvitationFromContinuation: async (
      ...args: Parameters<
        typeof actual.acceptCustomerInvitationFromContinuation
      >
    ) => {
      if (acceptState.fail) throw new Error("acceptance refused");
      return actual.acceptCustomerInvitationFromContinuation(...args);
    },
  };
});

const PORTAL_HOST = "portal.localhost:5174";
const AGENT_ORIGIN = "http://localhost:1337";
const PROVIDER_IDS = ["auth.password", "auth.magic-link", "auth.email-otp"];

async function enableCustomerProviders() {
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  for (const provider of ["email-otp", "magic-link"]) {
    await db.insert(schema.instancePluginConfigTable).values({
      id: randomUUID(),
      pluginId: `auth.${provider}`,
      instanceKey: `p3r1-${provider}`,
      displayName: `P3 R1 ${provider}`,
      enabled: true,
      config: {},
      scope: "instance",
      workspaceId: null,
      portalScope: "customer",
      configVersion: 1,
    });
  }
  await reloadAuthConfiguration();
}

let appInstance: ReturnType<typeof createApp>["app"] | null = null;
function sharedApp() {
  appInstance ??= createApp().app;
  return appInstance;
}

type Door = "portal" | "agent";

function doorHeaders(door: Door, ip = nextClientIp()) {
  const origin =
    door === "portal" ? getConfiguredCustomerOrigin() : AGENT_ORIGIN;
  return {
    host: door === "portal" ? PORTAL_HOST : new URL(AGENT_ORIGIN).host,
    origin,
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
}

function base(door: Door) {
  return door === "portal" ? getConfiguredCustomerOrigin() : AGENT_ORIGIN;
}

async function otpSignIn(door: Door, email: string) {
  const ip = nextClientIp();
  const app = sharedApp();
  mailState.otp = null;
  const sent = await app.request(
    `${base(door)}/api/auth/email-otp/send-verification-otp`,
    {
      method: "POST",
      headers: doorHeaders(door, ip),
      body: JSON.stringify({ email, type: "sign-in" }),
    },
  );
  expect(sent.status, await sent.clone().text()).toBe(200);
  expect(mailState.otp).toBeTruthy();
  return app.request(`${base(door)}/api/auth/sign-in/email-otp`, {
    method: "POST",
    headers: doorHeaders(door, ip),
    body: JSON.stringify({ email, otp: mailState.otp }),
  });
}

async function magicLinkSignIn(door: Door, email: string) {
  const ip = nextClientIp();
  const app = sharedApp();
  mailState.magicLink = null;
  const sent = await app.request(`${base(door)}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: doorHeaders(door, ip),
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  expect(sent.status, await sent.clone().text()).toBe(200);
  expect(mailState.magicLink).toBeTruthy();
  const token = new URL(mailState.magicLink as string).searchParams.get(
    "token",
  );
  return app.request(
    `${base(door)}/api/auth/magic-link/verify?token=${encodeURIComponent(token as string)}&callbackURL=/`,
    { headers: doorHeaders(door, ip), redirect: "manual" },
  );
}

async function plantApiKey(userId: string) {
  const [row] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: `hashed-${randomUUID()}`,
      name: "survivor key",
      start: "tdk_test",
      prefix: "taskdesk",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: schema.apikeyTable.id });
  return row?.id as string;
}

async function footprint(userId: string) {
  const [user] = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  const persons = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId));
  const keys = await db
    .select({ id: schema.apikeyTable.id })
    .from(schema.apikeyTable)
    .where(eq(schema.apikeyTable.userId, userId));
  const personIds = persons.map((person) => person.id);
  const [memberships] = personIds.length
    ? await db
        .select({ value: count() })
        .from(schema.membershipTable)
        .where(inArray(schema.membershipTable.personId, personIds))
    : [{ value: 0 }];
  const [sessions] = await db
    .select({ value: count() })
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, userId));
  const [workspaceRows] = await db
    .select({ value: count() })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, userId));
  return {
    userExists: Boolean(user),
    persons: persons.length,
    keys: keys.length,
    memberships: memberships?.value ?? 0,
    workspaceRows: workspaceRows?.value ?? 0,
    sessions: sessions?.value ?? 0,
  };
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

async function userByEmail(email: string) {
  const [row] = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));
  return row;
}

beforeEach(async () => {
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
  await enableCustomerProviders();
  await ensureCustomerRole();
  emailMock.configured = true;
  emailMock.failTransport = false;
  acceptState.fail = false;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db
    .delete(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PROVIDER_IDS));
  await reloadAuthConfiguration();
});

type Case = {
  name: string;
  setup: () => Promise<{ userId: string; email: string }>;
};

const survivors: Case[] = [
  {
    name: "an existing staff user",
    setup: async () => {
      const member = await createWorkspaceMember({ role: "member" });
      return { userId: member.user.id, email: member.user.email };
    },
  },
  {
    name: "an instance administrator",
    setup: async () => {
      const member = await createWorkspaceMember({ role: "owner" });
      await db
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, member.user.id));
      return { userId: member.user.id, email: member.user.email };
    },
  },
  {
    name: "a deactivated customer",
    setup: async () => {
      const org = await insertOrganisation("Deactivated Customer Org");
      const { user, personId } = await createCustomerUser({
        organisationId: org.id,
        person: true,
      });
      await grantCustomerOrganisationMembership(org.id, personId as string);
      await db
        .update(schema.personTable)
        .set({ active: false })
        .where(eq(schema.personTable.id, personId as string));
      return { userId: user.id, email: user.email };
    },
  },
  {
    name: "a customer whose organisation lost portal access",
    setup: async () => {
      const org = await insertOrganisation("Lost Access Org");
      const { user, personId } = await createCustomerUser({
        organisationId: org.id,
        person: true,
      });
      await grantCustomerOrganisationMembership(org.id, personId as string);
      await db
        .update(schema.organisationTable)
        .set({ portalAccess: false })
        .where(eq(schema.organisationTable.id, org.id));
      return { userId: user.id, email: user.email };
    },
  },
];

describe("P3-R1-01 portal sign-in never deletes an existing account", () => {
  for (const door of ["email-otp", "magic-link"] as const) {
    describe(`through ${door}`, () => {
      for (const entry of survivors) {
        it(`keeps ${entry.name}, revokes the session and audits the refusal`, async () => {
          const { userId, email } = await entry.setup();
          const keyId = await plantApiKey(userId);
          const before = await footprint(userId);
          expect(before.userExists).toBe(true);

          const response =
            door === "email-otp"
              ? await otpSignIn("portal", email)
              : await magicLinkSignIn("portal", email);
          const cookies = response.headers.getSetCookie().join(";");
          expect(cookies).not.toMatch(/session_token=[^;]+(?<!=);/u);

          const after = await footprint(userId);
          expect(after.userExists).toBe(true);
          expect(after.persons).toBe(before.persons);
          expect(after.memberships).toBe(before.memberships);
          expect(after.workspaceRows).toBe(before.workspaceRows);
          expect(after.keys).toBe(1);
          expect(after.sessions).toBe(0);
          const [key] = await db
            .select({ id: schema.apikeyTable.id })
            .from(schema.apikeyTable)
            .where(eq(schema.apikeyTable.id, keyId));
          expect(key?.id).toBe(keyId);
          expect(
            await refusalAudits(userId, "customer_identity_unavailable"),
          ).toHaveLength(1);
        });
      }
    });
  }

  it("refuses a brand-new address that carries no invitation and creates no user", async () => {
    const email = `nobody-${randomUUID()}@example.test`;
    const response = await otpSignIn("portal", email);
    expect(response.status).not.toBe(200);
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("removes a row created by this very request when acceptance then fails", async () => {
    const world = await import("./helpers/p5-invite").then((m) =>
      m.inviteWorld(),
    );
    const invited = await world.invite(`fresh-${randomUUID()}@example.test`);
    expect(invited.credential).toBeTruthy();
    vi.restoreAllMocks();
    // The continuation context is browser-bound; drive it exactly like the provider test does.
    const origin = getConfiguredCustomerOrigin();
    const ip = nextClientIp();
    const start = await world.app.request(
      `${origin}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation`,
      {
        method: "POST",
        headers: {
          host: PORTAL_HOST,
          origin,
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ credential: invited.credential }),
      },
    );
    expect(start.status).toBe(204);
    const cookie = start.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("__Host-tdk_customer_invite_"))
      ?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    const headers = {
      host: PORTAL_HOST,
      origin,
      cookie: cookie as string,
      "x-taskdesk-invitation-id": invited.id,
      "x-forwarded-for": ip,
      "content-type": "application/json",
    };
    mailState.otp = null;
    const sent = await world.app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: invited.email, type: "sign-in" }),
      },
    );
    expect(sent.status).toBe(200);
    acceptState.fail = true;
    const refused = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: invited.email, otp: mailState.otp }),
      },
    );
    expect(refused.status).toBe(403);
    expect(await userByEmail(invited.email)).toBeUndefined();
  });

  it("still admits a valid invitation (the accepted path is unchanged)", async () => {
    const world = await import("./helpers/p5-invite").then((m) =>
      m.inviteWorld(),
    );
    const invited = await world.invite(`valid-${randomUUID()}@example.test`);
    vi.restoreAllMocks();
    const origin = getConfiguredCustomerOrigin();
    const ip = nextClientIp();
    const start = await world.app.request(
      `${origin}/api/portal/invitations/${encodeURIComponent(invited.id)}/continuation`,
      {
        method: "POST",
        headers: {
          host: PORTAL_HOST,
          origin,
          "content-type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ credential: invited.credential }),
      },
    );
    const cookie = start.headers
      .getSetCookie()
      .find((entry) => entry.startsWith("__Host-tdk_customer_invite_"))
      ?.split(";", 1)[0];
    const headers = {
      host: PORTAL_HOST,
      origin,
      cookie: cookie as string,
      "x-taskdesk-invitation-id": invited.id,
      "x-forwarded-for": ip,
      "content-type": "application/json",
    };
    mailState.otp = null;
    await world.app.request(
      `${origin}/api/auth/email-otp/send-verification-otp`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: invited.email, type: "sign-in" }),
      },
    );
    const signedIn = await world.app.request(
      `${origin}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: invited.email, otp: mailState.otp }),
      },
    );
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    const created = await userByEmail(invited.email);
    expect(created).toBeDefined();
    const [person] = await db
      .select({ side: schema.personTable.side })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, created?.id as string));
    expect(person?.side).toBe("customer");
  });
});

describe("P3-R1-08 the agent host refuses a customer-side person", () => {
  it("revokes the session, keeps the account and audits the refusal", async () => {
    const org = await insertOrganisation("Agent Door Org");
    const { user, personId } = await createCustomerUser({
      organisationId: org.id,
      person: true,
    });
    await grantCustomerOrganisationMembership(org.id, personId as string);
    const before = await footprint(user.id);
    const response = await otpSignIn("agent", user.email);
    expect(response.headers.getSetCookie().join(";")).not.toMatch(
      /session_token=[^;]+(?<!=);/u,
    );
    const after = await footprint(user.id);
    expect(after.userExists).toBe(true);
    expect(after.persons).toBe(before.persons);
    expect(after.memberships).toBe(before.memberships);
    expect(after.sessions).toBe(0);
    expect(await refusalAudits(user.id, "customer_on_agent_host")).toHaveLength(
      1,
    );
  });

  it("still admits a staff user on the agent host", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const response = await otpSignIn("agent", member.user.email);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await footprint(member.user.id)).sessions).toBe(1);
  });
});
