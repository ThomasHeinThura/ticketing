import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { consumeApiKeyRateLimit } from "../../apps/api/src/api-key/rate-limit-store";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyRateLimitCounterTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function makeKey(input: { isMcp?: boolean; limit?: number } = {}) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const key = await createPersonalApiKey(
    { userId: owner.user.id },
    {
      name: "shared rate-limit integration",
      ...(input.isMcp ? { isMcp: true } : {}),
      ...(input.limit === undefined ? {} : { rateLimitPerMinute: input.limit }),
    },
  );
  return { owner, key };
}

async function counter(keyId: string, bucket: string) {
  const [row] = await db
    .select()
    .from(apiKeyRateLimitCounterTable)
    .where(
      and(
        eq(apiKeyRateLimitCounterTable.apiKeyId, keyId),
        eq(apiKeyRateLimitCounterTable.bucket, bucket),
      ),
    );
  return row;
}

describe("shared API-key rate limits (AK-4, MC-10, MC-22)", () => {
  it("caps total requests across read/write classes and leaves refused requests uncounted", async () => {
    const { owner, key } = await makeKey({ limit: 2 });
    const { app } = createApp();
    const request = () => {
      mockAnonymousSession();
      return app.request(
        `/api/project?workspaceId=${encodeURIComponent(owner.workspace.id)}`,
        { headers: { "x-api-key": key.key } },
      );
    };

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    const denied = await app.request("/api/work-items/bulk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key.key,
      },
      body: "{}",
    });
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await counter(key.id, "total"))?.requestCount).toBe(2);
    expect((await counter(key.id, "mcp_write"))?.requestCount).toBe(0);
  });

  it("reads the persisted MCP ceiling and refuses writes atomically across all MCP counters", async () => {
    const { owner, key } = await makeKey({ isMcp: true, limit: 20 });
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({
        featureKey: "feature.mcp",
        enabled: true,
      })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true },
      });
    await db
      .insert(schema.instanceSettingTable)
      .values({
        id: "singleton",
        setupCompletedAt: new Date(),
        mcpWriteCeilingPerMinute: 1,
      })
      .onConflictDoUpdate({
        target: schema.instanceSettingTable.id,
        set: { mcpWriteCeilingPerMinute: 1 },
      });
    const { app } = createApp();
    const request = () =>
      app.request("/api/work-items/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key.key,
        },
        body: "{}",
      });

    mockAnonymousSession();
    const read = await app.request(
      `/api/project?workspaceId=${encodeURIComponent(owner.workspace.id)}`,
      { headers: { "x-api-key": key.key } },
    );
    expect(read.status).toBe(200);
    const first = await request();
    expect(first.status).not.toBe(429);
    const refused = await request();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await counter(key.id, "total"))?.requestCount).toBe(2);
    expect((await counter(key.id, "mcp_write"))?.requestCount).toBe(1);
    expect((await counter(key.id, "mcp_bulk"))?.requestCount).toBe(1);
  });

  it("admits concurrent requests atomically and isolates different keys", async () => {
    const first = await makeKey({ limit: 4 });
    const second = await makeKey({ limit: 4 });
    const requests = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeApiKeyRateLimit({
          apiKeyId: first.key.id,
          isMcp: false,
          keyLimitPerMinute: 4,
          requestClass: "read",
        }),
      ),
    );
    expect(requests.filter((entry) => entry.allowed)).toHaveLength(4);
    expect(requests.filter((entry) => !entry.allowed)).toHaveLength(16);
    expect((await counter(first.key.id, "total"))?.requestCount).toBe(4);

    const otherKey = await consumeApiKeyRateLimit({
      apiKeyId: second.key.id,
      isMcp: false,
      keyLimitPerMinute: 4,
      requestClass: "read",
    });
    expect(otherKey.allowed).toBe(true);
    expect((await counter(second.key.id, "total"))?.requestCount).toBe(1);
  });

  it("fails closed when the persisted counter cannot reference a real API key", async () => {
    await expect(
      consumeApiKeyRateLimit({
        apiKeyId: "missing-api-key",
        isMcp: false,
        keyLimitPerMinute: 2,
        requestClass: "read",
      }),
    ).rejects.toThrow();
  });
});
