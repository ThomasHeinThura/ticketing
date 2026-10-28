import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import {
  apiKeyExtensionTable,
  apiKeyRateLimitCounterTable,
} from "../../apps/api/src/database/schema";
import { mcpToolInvocationTable } from "../../apps/api/src/database/schema-mcp-telemetry";
import { createApp } from "../../apps/api/src/index";
import { purgeExpiredToolReports } from "../../apps/api/src/mcp-telemetry/repository";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => resetTestDatabase());

async function createMcpKey(rateLimitPerMinute = 20) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const key = await createPersonalApiKey(
    { userId: owner.user.id },
    {
      name: "MCP telemetry integration key",
      isMcp: true,
      rateLimitPerMinute,
    },
  );
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.mcp", enabled: true })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true },
    });
  return { owner, key };
}

function report(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  mockAnonymousSession();
  return app.request("/api/mcp/tool-reports", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify(body),
  });
}

function sample(input: Partial<Record<string, unknown>> = {}) {
  return {
    invocationId: randomUUID(),
    toolName: "whoami",
    durationMs: 24,
    outcome: "success",
    ...input,
  };
}

describe("POST /api/mcp/tool-reports", () => {
  it("records only bounded reports for verified personal MCP keys", async () => {
    const { key } = await createMcpKey();
    const { app } = createApp();
    const invocationId = randomUUID();
    const response = await report(
      app,
      key.key,
      sample({
        invocationId,
        toolName: "get_work_item_activity",
        durationMs: 61,
        outcome: "error",
      }),
    );
    expect(response.status, await response.clone().text()).toBe(204);

    const rows = await db
      .select()
      .from(mcpToolInvocationTable)
      .where(eq(mcpToolInvocationTable.apiKeyId, key.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      apiKeyId: key.id,
      invocationId,
      toolName: "get_work_item_activity",
      durationMs: 61,
      outcome: "error",
    });
    expect(rows[0]?.recordedAt).toBeInstanceOf(Date);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "apiKeyId",
      "durationMs",
      "invocationId",
      "outcome",
      "recordedAt",
      "toolName",
    ]);
    expect(JSON.stringify(rows)).not.toContain("arguments");
    expect(JSON.stringify(rows)).not.toContain("private prompt");
  });

  it("acknowledges exact retries and refuses conflicting invocation reuse", async () => {
    const { key } = await createMcpKey();
    const { app } = createApp();
    const body = sample({ invocationId: randomUUID() });
    expect((await report(app, key.key, body)).status).toBe(204);
    expect((await report(app, key.key, body)).status).toBe(204);
    expect(
      (
        await report(app, key.key, {
          ...body,
          outcome: "error",
        })
      ).status,
    ).toBe(409);
    const rows = await db
      .select()
      .from(mcpToolInvocationTable)
      .where(eq(mcpToolInvocationTable.apiKeyId, key.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("success");
  });

  it("rejects unknown tools, out-of-range durations and extra request data", async () => {
    const { key } = await createMcpKey();
    const { app } = createApp();
    expect(
      (await report(app, key.key, sample({ toolName: "unregistered_tool" })))
        .status,
    ).toBe(400);
    expect(
      (await report(app, key.key, sample({ durationMs: 600_001 }))).status,
    ).toBe(400);
    expect(
      (await report(app, key.key, sample({ prompt: "private prompt" }))).status,
    ).toBe(400);
    expect(await db.select().from(mcpToolInvocationTable)).toHaveLength(0);
  });

  it("refuses browser sessions and ordinary personal API keys", async () => {
    const { owner } = await createMcpKey();
    const ordinary = await createPersonalApiKey(
      { userId: owner.user.id },
      { name: "Ordinary personal key" },
    );
    const { app } = createApp();
    mockAuthenticatedSession(owner.user);
    const sessionResponse = await app.request("/api/mcp/tool-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample()),
    });
    expect(sessionResponse.status).toBe(403);
    expect((await report(app, ordinary.key, sample())).status).toBe(403);
  });

  it("preserves the instance MCP feature gate and disabled-key denial", async () => {
    const { key } = await createMcpKey();
    const { app } = createApp();
    await db
      .update(schema.instanceFeatureFlagTable)
      .set({ enabled: false })
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.mcp"));
    expect((await report(app, key.key, sample())).status).toBe(404);
    await db
      .update(schema.instanceFeatureFlagTable)
      .set({ enabled: true })
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.mcp"));

    await db
      .update(apiKeyExtensionTable)
      .set({ disabledAt: new Date() })
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect((await report(app, key.key, sample())).status).toBe(401);
    expect(await db.select().from(mcpToolInvocationTable)).toHaveLength(0);
  });

  it("uses the bounded total key budget without touching MCP write or burst buckets", async () => {
    const { key } = await createMcpKey(1);
    const { app } = createApp();
    expect((await report(app, key.key, sample())).status).toBe(204);
    const refused = await report(app, key.key, sample());
    expect(refused.status).toBe(429);

    const [total] = await db
      .select()
      .from(apiKeyRateLimitCounterTable)
      .where(
        and(
          eq(apiKeyRateLimitCounterTable.apiKeyId, key.id),
          eq(apiKeyRateLimitCounterTable.bucket, "total"),
        ),
      );
    const writeCounters = await db
      .select()
      .from(apiKeyRateLimitCounterTable)
      .where(
        and(
          eq(apiKeyRateLimitCounterTable.apiKeyId, key.id),
          eq(apiKeyRateLimitCounterTable.bucket, "mcp_write"),
        ),
      );
    const burstCounters = await db
      .select()
      .from(apiKeyRateLimitCounterTable)
      .where(
        and(
          eq(apiKeyRateLimitCounterTable.apiKeyId, key.id),
          eq(apiKeyRateLimitCounterTable.bucket, "mcp_burst"),
        ),
      );
    expect(total?.requestCount).toBe(1);
    expect(writeCounters[0]?.requestCount).toBe(0);
    expect(burstCounters[0]?.requestCount).toBe(0);
    const [extension] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(extension?.disabledAt).toBeNull();
  });

  it("purges only expired rows in one bounded cleanup batch", async () => {
    const { key } = await createMcpKey();
    const now = new Date();
    await db.insert(mcpToolInvocationTable).values([
      {
        apiKeyId: key.id,
        invocationId: randomUUID(),
        toolName: "whoami",
        durationMs: 20,
        outcome: "success",
        recordedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
      },
      {
        apiKeyId: key.id,
        invocationId: randomUUID(),
        toolName: "whoami",
        durationMs: 30,
        outcome: "success",
        recordedAt: now,
      },
    ]);
    expect(await purgeExpiredToolReports()).toBe(1);
    const remaining = await db
      .select()
      .from(mcpToolInvocationTable)
      .where(eq(mcpToolInvocationTable.apiKeyId, key.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.recordedAt.getTime()).toBeGreaterThan(
      now.getTime() - 60_000,
    );
  });
});
