import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { legacySha256ApiKeyHash } from "../../apps/api/src/api-key/secret-hash";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { mcpToolInvocationTable } from "../../apps/api/src/database/schema-mcp-telemetry";
import { createApp } from "../../apps/api/src/index";
import { readMcpUsage } from "../../apps/api/src/instance/mcp-usage";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const password = "mcp-usage-integration-fixture-password";

async function makeUser(role: string | null) {
  const id = `mcp-usage-${randomUUID()}`;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: "Synthetic MCP usage actor",
      email: `${id}@example.test`,
      emailVerified: true,
      role,
    })
    .returning();
  if (!user) throw new Error("MCP usage actor fixture was not created");
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person) throw new Error("MCP usage person fixture was not created");
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

async function makeMcpKey(
  personId: string,
  userId: string,
  input: { enabled?: boolean } = {},
) {
  const id = `mcp_${randomUUID()}`;
  const rawKey = `taskdesk_mcp_usage_${randomUUID()}`;
  await db.insert(schema.apikeyTable).values({
    id,
    referenceId: userId,
    userId,
    key: legacySha256ApiKeyHash(rawKey),
    name: "Synthetic MCP usage key",
    start: rawKey.slice(0, 16),
    prefix: "taskdesk",
    enabled: input.enabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(apiKeyExtensionTable).values({
    apikeyId: id,
    personId,
    isMcp: true,
    disabledAt: input.enabled === false ? new Date() : null,
    disabledReason: input.enabled === false ? "auto_disabled" : null,
  });
  return { id, rawKey };
}

async function recordMcpRequest(apiKeyId: string, actorId: string) {
  await appendAuditLog(db, {
    actorId,
    actorType: "api_key",
    apiKeyId,
    action: "mcp.request",
    entityType: "api_key",
    entityId: apiKeyId,
    after: { agentOriginated: true },
  });
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("instance MCP usage HTTP API", () => {
  it("returns recorded request counts and auto-disable metadata without credential material", async () => {
    const { user, person } = await makeUser("admin");
    const active = await makeMcpKey(person.id, user.id);
    const disabled = await makeMcpKey(person.id, user.id, { enabled: false });
    await recordMcpRequest(active.id, user.id);
    await recordMcpRequest(active.id, user.id);
    await recordMcpRequest(disabled.id, user.id);
    await db.insert(mcpToolInvocationTable).values([
      {
        apiKeyId: active.id,
        invocationId: randomUUID(),
        toolName: "whoami",
        durationMs: 41,
        outcome: "success",
      },
      {
        apiKeyId: active.id,
        invocationId: randomUUID(),
        toolName: "whoami",
        durationMs: 81,
        outcome: "error",
      },
      {
        apiKeyId: disabled.id,
        invocationId: randomUUID(),
        toolName: "list_projects",
        durationMs: 100,
        outcome: "error",
      },
    ]);
    await appendAuditLog(db, {
      actorId: null,
      actorType: "system",
      apiKeyId: disabled.id,
      action: "api_key.auto_disabled",
      entityType: "api_key",
      entityId: disabled.id,
      after: { reason: "burst_threshold" },
    });

    const projection = await readMcpUsage();
    expect(projection.keys).toHaveLength(2);

    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await app.request("/api/instance/mcp/usage", {
      headers: { cookie },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");

    const body = (await response.json()) as {
      periodStart: string;
      periodEnd: string;
      hasMore: boolean;
      keys: Array<Record<string, unknown>>;
    };
    expect(Date.parse(body.periodEnd) - Date.parse(body.periodStart)).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(body.hasMore).toBe(false);
    expect(body.keys).toHaveLength(2);
    const activeRow = body.keys.find((row) => row.id === active.id);
    expect(activeRow).toMatchObject({
      id: active.id,
      name: "Synthetic MCP usage key",
      enabled: true,
      recordedRequestCount: 2,
      clientReportedTools: [
        {
          toolName: "whoami",
          callCount: 2,
          errorCount: 1,
          errorRate: 0.5,
          meanDurationMs: 61,
          maxDurationMs: 81,
        },
      ],
    });
    expect(activeRow?.lastRecordedAt).toEqual(expect.any(String));
    expect(activeRow?.autoDisabledAt).toBeNull();
    const disabledRow = body.keys.find((row) => row.id === disabled.id);
    expect(disabledRow).toMatchObject({
      id: disabled.id,
      enabled: false,
      recordedRequestCount: 1,
      clientReportedTools: [
        {
          toolName: "list_projects",
          callCount: 1,
          errorCount: 1,
          errorRate: 1,
        },
      ],
    });
    expect(disabledRow?.autoDisabledAt).toEqual(expect.any(String));
    const serialized = JSON.stringify(body);
    for (const secret of [active.rawKey, disabled.rawKey])
      expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("owner");
  });

  it("denies a signed-in non-admin", async () => {
    const { user } = await makeUser(null);
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await app.request("/api/instance/mcp/usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });

  it("denies an API key even when its owner is an administrator", async () => {
    const { user } = await makeUser("admin");
    const rawKey = `taskdesk_mcp_usage_session_only_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      userId: user.id,
      referenceId: user.id,
      key: legacySha256ApiKeyHash(rawKey),
      name: "Session-only MCP route fixture",
      start: rawKey.slice(0, 16),
      prefix: "taskdesk",
      permissions: JSON.stringify({ "instance:admin": true }),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = createApp();
    const response = await app.request("/api/instance/mcp/usage", {
      headers: { "x-api-key": rawKey },
    });
    expect([401, 403]).toContain(response.status);
  });

  it("denies an impersonated administrator", async () => {
    const { user } = await makeUser("admin");
    mockAuthenticatedSession(user, { impersonatedBy: `actor-${randomUUID()}` });
    const { app } = createApp();
    const response = await app.request("/api/instance/mcp/usage");
    expect(response.status).toBe(403);
  });

  it("denies a customer portal session", async () => {
    const customer = await createCustomerPrincipal();
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const { app } = createApp();
    const response = await app.request("/api/instance/mcp/usage", {
      headers: {
        cookie: `__Host-tdk_agent_session=token-${customer.user.id}`,
      },
    });
    expect([401, 403]).toContain(response.status);
  });
});
