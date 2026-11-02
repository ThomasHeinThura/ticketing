import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
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
  const password = `pw-${randomUUID()}`;
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
