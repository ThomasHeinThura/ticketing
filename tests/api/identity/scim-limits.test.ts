/** IP-14: per-connection rate limit and oversized-body rejection (DB-free). */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCIM_MAX_BODY_BYTES,
  scimBodyLimit,
  scimConnectionRateLimit,
} from "../../../apps/api/src/identity/scim-limits.js";

vi.mock("../../../apps/api/src/identity/scim-rate-limit-store", () => ({
  consumeScimRateLimit: vi.fn(),
  reportScimRateLimitUnavailable: vi.fn(),
}));
vi.mock("../../../apps/api/src/identity/scim-auth-events", () => ({
  recordScimRequestDenied: vi.fn(),
}));

import { consumeScimRateLimit } from "../../../apps/api/src/identity/scim-rate-limit-store";

beforeEach(() => {
  vi.mocked(consumeScimRateLimit)
    .mockReset()
    .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

function app() {
  const hono = new Hono<{ Variables: { connectionId: string } }>();
  hono.use("*", async (c, next) => {
    c.set("connectionId", c.req.header("x-test-connection") ?? "");
    await next();
  });
  hono.use(
    "*",
    scimConnectionRateLimit((c) => c.get("connectionId") || undefined),
  );
  hono.use("*", scimBodyLimit(64));
  hono.post("/Users", async (c) => c.json(await c.req.json(), 200));
  return hono;
}

describe("SCIM connection rate limit", () => {
  it("returns a SCIM 429 with Retry-After and forwards each connection key", async () => {
    const hono = app();
    const call = (connection: string) =>
      hono.request("/Users", {
        method: "POST",
        headers: {
          "content-type": "application/scim+json",
          "x-test-connection": connection,
        },
        body: JSON.stringify({ a: 1 }),
      });
    expect((await call("c1")).status).toBe(200);
    expect((await call("c1")).status).toBe(200);
    vi.mocked(consumeScimRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const limited = await call("c1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("42");
    expect(limited.headers.get("content-type")).toContain(
      "application/scim+json",
    );
    const body = (await limited.json()) as {
      schemas: string[];
      status: string;
    };
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
    expect(body.status).toBe("429");
    expect((await call("c2")).status).toBe(200);
    expect(
      vi.mocked(consumeScimRateLimit).mock.calls.map(([input]) => input.key),
    ).toEqual(["c1", "c1", "c1", "c2"]);
  });
});

describe("SCIM body limit", () => {
  it("rejects a declared-oversized body with a SCIM 413 tooLarge", async () => {
    const hono = app();
    const payload = JSON.stringify({ blob: "x".repeat(200) });
    const response = await hono.request("/Users", {
      method: "POST",
      headers: {
        "content-type": "application/scim+json",
        "x-test-connection": "c1",
        "content-length": String(payload.length),
      },
      body: payload,
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as {
      scimType: string;
      status: string;
    };
    expect(body.scimType).toBe("tooLarge");
    expect(body.status).toBe("413");
  });

  it("accepts a body within the limit, and the production cap is 2 MiB", async () => {
    const hono = app();
    const response = await hono.request("/Users", {
      method: "POST",
      headers: {
        "content-type": "application/scim+json",
        "x-test-connection": "c1",
      },
      body: JSON.stringify({ ok: true }),
    });
    expect(response.status).toBe(200);
    expect(SCIM_MAX_BODY_BYTES).toBe(2 * 1024 * 1024);
  });
});
