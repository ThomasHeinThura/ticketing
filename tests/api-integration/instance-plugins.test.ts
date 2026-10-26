import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { legacySha256ApiKeyHash } from "../../apps/api/src/api-key/secret-hash";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import { EMAIL_PLUGIN_ID } from "../../apps/api/src/notification-provider/repository";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const password = "plugins-integration-fixture-password";

async function makeUser(role: string | null) {
  const id = `plugins-api-${randomUUID()}`;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: "Synthetic plugins API actor",
      email: `${id}@example.test`,
      emailVerified: true,
      role,
    })
    .returning();
  if (!user) throw new Error("Plugins API user fixture was not created");
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person)
    throw new Error("Plugins API staff person fixture was not created");
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  return { user, person };
}

async function signIn(app: ReturnType<typeof createApp>["app"], email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(`Fixture sign-in returned ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie)
    throw new Error("Fixture sign-in did not issue an agent session");
  return cookie;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("instance Plugins HTTP API", () => {
  it("returns current persisted provider metadata to an admin without config or secret values", async () => {
    const { user, person } = await makeUser("admin");
    const configId = randomUUID();
    const syntheticSecret = `smtp-fixture-${randomUUID()}`;
    await db.insert(schema.instancePluginConfigTable).values({
      id: configId,
      pluginId: EMAIL_PLUGIN_ID,
      instanceKey: "default",
      displayName: "Email",
      enabled: true,
      config: {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        requireTLS: true,
        username: "fixture-mailer",
        fromAddress: "noreply@example.test",
        replyTo: null,
      },
      secrets: encryptIdentityClientSecret(configId, syntheticSecret),
      scope: "instance",
      workspaceId: null,
      portalScope: null,
      configVersion: 7,
      updatedBy: person.id,
    });
    const { app } = createApp();
    const cookie = await signIn(app, user.email);

    const response = await app.request("/api/instance/plugins", {
      headers: { cookie },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = (await response.json()) as {
      plugins: Array<Record<string, unknown>>;
    };
    expect(body.plugins).toEqual([
      expect.objectContaining({
        id: "notify.email",
        name: "Email",
        kind: "notification",
        state: "enabled",
        source: "runtime",
        configVersion: 7,
        credentialConfigured: true,
        settingsForm: expect.objectContaining({
          version: 1,
          available: true,
          fields: expect.arrayContaining([
            expect.objectContaining({
              key: "config.host",
              control: "text",
              required: true,
              maxLength: 253,
            }),
            expect.objectContaining({
              key: "config.port",
              control: "number",
              minimum: 1,
              maximum: 65535,
            }),
            expect.objectContaining({
              key: "password",
              control: "password",
              group: "secret",
              secret: true,
            }),
          ]),
        }),
      }),
    ]);
    const serialized = JSON.stringify(body);
    for (const withheld of [
      syntheticSecret,
      "smtp.example.test",
      "fixture-mailer",
      "noreply@example.test",
      "passwordPreview",
      "secrets",
    ])
      expect(serialized).not.toContain(withheld);

    const [stored] = await db
      .select({ id: schema.instancePluginConfigTable.id })
      .from(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.id, configId));
    expect(stored?.id).toBe(configId);
  });

  it("denies a signed-in non-admin", async () => {
    const { user } = await makeUser(null);
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await app.request("/api/instance/plugins", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });

  it("denies a customer portal session", async () => {
    const customer = await createCustomerPrincipal();
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const { app } = createApp();
    const response = await app.request("/api/instance/plugins", {
      headers: {
        cookie: `__Host-tdk_agent_session=token-${customer.user.id}`,
      },
    });
    expect([401, 403]).toContain(response.status);
  });

  it("denies an impersonated administrator", async () => {
    const { user } = await makeUser("admin");
    mockAuthenticatedSession(user, { impersonatedBy: `actor-${randomUUID()}` });
    const { app } = createApp();
    const response = await app.request("/api/instance/plugins");
    expect(response.status).toBe(403);
  });

  it("denies an API key even when its owner is an administrator", async () => {
    const { user } = await makeUser("admin");
    mockAnonymousSession();
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: user.id,
      userId: user.id,
      key: legacySha256ApiKeyHash(rawKey),
      name: "session-only plugin route fixture",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ "instance:manage_plugins": true }),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = createApp();
    const response = await app.request("/api/instance/plugins", {
      headers: { "x-api-key": rawKey },
    });
    expect([401, 403]).toContain(response.status);
  });
});
