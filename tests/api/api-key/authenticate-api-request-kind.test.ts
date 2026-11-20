import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyKind } from "../../../apps/api/src/api-key/credential";
import { legacyPersonalKeyKind } from "../../../apps/api/src/api-key/credential";

const storedPermissions = vi.hoisted(() => ({ value: null as string | null }));

const loadApiKeyKindMock = vi.fn<(keyId: string) => Promise<ApiKeyKind>>();
const consumeApiKeyRateLimitMock = vi.fn();
const recordApiKeyUseMock = vi.fn();
const auditMcpRequestMock = vi.fn();

vi.mock("../../../apps/api/src/api-key/repository", () => ({
  findActiveApiKeysBySelector: vi.fn(async () => []),
  loadApiKeyBurstThreshold: vi.fn(async () => 300),
  loadApiKeyKind: (keyId: string) => loadApiKeyKindMock(keyId),
  loadMcpWriteCeilingPerMinute: vi.fn(async () => 30),
  recordApiKeyUse: (...args: unknown[]) => recordApiKeyUseMock(...args),
  upgradeApiKeyHash: vi.fn(async () => undefined),
}));

vi.mock("../../../apps/api/src/api-key/rate-limit-store", () => ({
  consumeApiKeyRateLimit: (...args: unknown[]) =>
    consumeApiKeyRateLimitMock(...args),
}));

vi.mock("../../../apps/api/src/utils/access-lookups.repository", () => ({
  findActiveApiKeyByHash: vi.fn(async () => ({
    id: "key-1",
    key: "stored-legacy-hash",
    referenceId: "user-1",
    userId: "user-1",
    name: "test-key",
    prefix: "tdk_",
    start: "tdk_ab",
    enabled: true,
    expiresAt: null,
    permissions: storedPermissions.value,
    refillInterval: null,
    refillAmount: null,
    lastRefillAt: null,
    rateLimitEnabled: null,
    rateLimitTimeWindow: null,
    rateLimitMax: null,
    requestCount: null,
    remaining: null,
    lastRequest: null,
    metadata: null,
  })),
  findApiKeyOwnerStatus: vi.fn(async () => ({
    banned: false,
    personActive: true,
    personSide: "staff",
  })),
}));

vi.mock("../../../apps/api/src/auth", () => ({
  authForHost: vi.fn(() => null),
  hasCustomerPortalIdentity: vi.fn(async () => false),
  portalForHost: vi.fn(() => "agent"),
}));

vi.mock("../../../apps/api/src/utils/mcp-feature-enabled", () => ({
  mcpFeatureEnabled: vi.fn(async () => true),
}));

vi.mock("../../../apps/api/src/utils/mcp-request-audit", () => ({
  auditMcpRequest: (...args: unknown[]) => auditMcpRequestMock(...args),
}));

import { authenticateApiRequest } from "../../../apps/api/src/utils/authenticate-api-request";
import { verifyApiKey } from "../../../apps/api/src/utils/verify-api-key";

describe("authenticateApiRequest single ApiKeyKind load (P-19)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedPermissions.value = JSON.stringify({ work_item: ["read"] });
    consumeApiKeyRateLimitMock.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
    });
    recordApiKeyUseMock.mockResolvedValue(undefined);
    auditMcpRequestMock.mockResolvedValue(undefined);
  });

  it.each([
    ["SQL null", null, null],
    ["empty permissions", "{}", {}],
    ["malformed JSON", "{", {}],
    ["malformed actions", JSON.stringify({ work_item: ["read", 1] }), {}],
    [
      "valid permissions",
      JSON.stringify({ work_item: ["read", "update"], project: ["read"] }),
      { work_item: ["read", "update"], project: ["read"] },
    ],
  ])(
    "preserves verifyApiKey permissions for %s",
    async (_label, raw, expected) => {
      storedPermissions.value = raw;
      loadApiKeyKindMock.mockResolvedValue(legacyPersonalKeyKind("key-1"));
      const result = await verifyApiKey("tdk_test_secret_value_123456");
      expect(result?.key.permissions).toStrictEqual(expected);
    },
  );

  it("loads ApiKeyKind once in verifyApiKey and passes it through enforcement without redundant DB reloads", async () => {
    const kind: ApiKeyKind = {
      ...legacyPersonalKeyKind("key-1"),
      isMcp: true,
    };
    loadApiKeyKindMock.mockResolvedValue(kind);

    const app = new Hono<{
      Variables: { userId: string; apiKey: unknown };
    }>();
    app.get("/api/probe", async (c) => {
      await authenticateApiRequest(c);
      return c.json({
        userId: c.get("userId"),
        apiKey: c.get("apiKey"),
      });
    });

    const res = await app.request("http://ticketing.localhost/api/probe", {
      headers: {
        host: "ticketing.localhost",
        "x-api-key": "tdk_test_secret_value_123456",
      },
    });

    expect(res.status).toBe(200);
    expect(loadApiKeyKindMock).toHaveBeenCalledTimes(1);
    expect(loadApiKeyKindMock).toHaveBeenCalledWith("key-1");
    expect(auditMcpRequestMock).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      ownerUserId: "user-1",
    });
    expect(await res.json()).toMatchObject({
      userId: "user-1",
      apiKey: {
        id: "key-1",
        isMcp: true,
      },
    });
  });

  it("enforces disabled-key refusal from the same single-loaded ApiKeyKind", async () => {
    loadApiKeyKindMock.mockResolvedValue({
      ...legacyPersonalKeyKind("key-1"),
      disabledAt: new Date("2026-11-01T00:00:00Z"),
    });

    const app = new Hono();
    app.get("/api/probe", async (c) => {
      await authenticateApiRequest(c);
      return c.json({ ok: true });
    });

    const res = await app.request("http://ticketing.localhost/api/probe", {
      headers: {
        host: "ticketing.localhost",
        Authorization: "Bearer tdk_test_secret_value_123456",
      },
    });

    expect(res.status).toBe(401);
    expect(loadApiKeyKindMock).toHaveBeenCalledTimes(1);
    expect(consumeApiKeyRateLimitMock).not.toHaveBeenCalled();
  });
});
