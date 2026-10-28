import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPersonalApiKey,
  createServiceApiKey,
} from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  apiKeyExtensionTable,
  apiKeyRateLimitCounterTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => resetTestDatabase());

async function enableMcp() {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.mcp", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
}

function keyRequest(app: ReturnType<typeof createApp>["app"], key: string) {
  mockAnonymousSession();
  return app.request("/api/me/identity", {
    headers: { "x-api-key": key },
  });
}

describe("GET /api/me/identity", () => {
  it("returns only the authenticated session user's own active staff identity", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const app = createApp().app;
    const before = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);

    const response = await app.request("/api/me/identity");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      user: { id: owner.user.id, name: owner.user.name },
      personId: expect.any(String),
      credentialType: "session",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    const after = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    expect(after).toEqual(before);
  });

  it("supports a personal API key and an MCP personal key without creating sessions", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const person = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1);
    const regularKey = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Identity read key" },
    );
    const legacyKey = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Legacy identity read key" },
    );
    await db
      .delete(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, legacyKey.id));
    await enableMcp();
    const mcpKey = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Identity MCP key", isMcp: true },
    );
    const app = createApp().app;
    const sessionsBefore = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);

    const regularResponse = await keyRequest(app, regularKey.key);
    expect(regularResponse.status, await regularResponse.clone().text()).toBe(
      200,
    );
    expect(await regularResponse.json()).toEqual({
      user: { id: owner.user.id, name: owner.user.name },
      personId: person[0]?.id,
      credentialType: "api_key",
    });
    expect(regularResponse.headers.get("set-cookie")).toBeNull();

    const legacyResponse = await keyRequest(app, legacyKey.key);
    expect(legacyResponse.status, await legacyResponse.clone().text()).toBe(
      200,
    );
    expect(await legacyResponse.json()).toEqual({
      user: { id: owner.user.id, name: owner.user.name },
      personId: person[0]?.id,
      credentialType: "api_key",
    });
    expect(legacyResponse.headers.get("set-cookie")).toBeNull();

    const mcpResponse = await keyRequest(app, mcpKey.key);
    expect(mcpResponse.status, await mcpResponse.clone().text()).toBe(200);
    expect(await mcpResponse.json()).toEqual({
      user: { id: owner.user.id, name: owner.user.name },
      personId: person[0]?.id,
      credentialType: "mcp_key",
    });
    expect(mcpResponse.headers.get("set-cookie")).toBeNull();
    const mcpAuditRows = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.apiKeyId, mcpKey.id),
          eq(schema.auditLogTable.action, "mcp.request"),
        ),
      );
    expect(mcpAuditRows).toHaveLength(1);
    const totalRateLimit = await db
      .select({ requestCount: apiKeyRateLimitCounterTable.requestCount })
      .from(apiKeyRateLimitCounterTable)
      .where(
        and(
          eq(apiKeyRateLimitCounterTable.apiKeyId, mcpKey.id),
          eq(apiKeyRateLimitCounterTable.bucket, "total"),
        ),
      );
    expect(totalRateLimit[0]?.requestCount).toBe(1);
    const sessionsAfter = await db
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable);
    expect(sessionsAfter).toEqual(sessionsBefore);
  });

  it("refuses service keys, invalid keys, and portal-host requests", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const serviceKey = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      { name: "Identity service key", capabilities: ["work_item:read"] },
    );
    const app = createApp().app;

    const serviceResponse = await keyRequest(app, serviceKey.key);
    expect(serviceResponse.status).toBe(403);
    expect(serviceResponse.headers.get("cache-control")).toBe("no-store");

    const invalidResponse = await keyRequest(app, "tdk_invalid-token-value");
    expect(invalidResponse.status).toBe(401);

    mockAuthenticatedSession(owner.user, { portal: "customer" });
    const portalResponse = await app.request("/api/me/identity", {
      headers: { host: "portal.localhost:5174" },
    });
    expect(portalResponse.status).toBe(404);
  });

  it("refuses disabled keys and keys whose owner is no longer active", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const key = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Revocable identity key" },
    );
    const app = createApp().app;

    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, key.id));
    expect((await keyRequest(app, key.key)).status).toBe(401);

    const activeKey = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Inactive owner identity key" },
    );
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, owner.user.id));
    expect((await keyRequest(app, activeKey.key)).status).toBe(401);
  });

  it("does not find another user's identity from a credential owner id alone", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const stranger = await createWorkspaceMember({ role: "owner" });
    const key = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Bound identity key" },
    );
    const { app } = createApp();
    const response = await keyRequest(app, key.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string };
      personId: string;
    };
    expect(body.user.id).toBe(owner.user.id);
    const strangerPerson = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(
        and(
          eq(schema.personTable.userId, stranger.user.id),
          eq(schema.personTable.active, true),
        ),
      )
      .limit(1);
    expect(body.personId).not.toBe(strangerPerson[0]?.id);
  });
});
