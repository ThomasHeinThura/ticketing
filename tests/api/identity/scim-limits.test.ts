/** IP-14: per-connection rate limit and oversized-body rejection (DB-free). */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  SCIM_MAX_BODY_BYTES,
  scimBodyLimit,
  scimConnectionRateLimit,
  WindowCounter,
} from "../../../apps/api/src/identity/scim-limits.js";

describe("WindowCounter", () => {
  it("allows up to the limit, refuses beyond it, and resets after the window", () => {
    let now = 1_000;
    const counter = new WindowCounter(2, 1_000, () => now);
    expect(counter.hit("a").allowed).toBe(true);
    expect(counter.hit("a").allowed).toBe(true);
    const refused = counter.hit("a");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(counter.isExhausted("a")).toBe(true);
    expect(counter.hit("b").allowed).toBe(true);
    now += 1_000;
    expect(counter.isExhausted("a")).toBe(false);
    expect(counter.hit("a").allowed).toBe(true);
  });
});

function app(counter: WindowCounter) {
  const hono = new Hono<{ Variables: { connectionId: string } }>();
  hono.use("*", async (c, next) => {
    c.set("connectionId", c.req.header("x-test-connection") ?? "");
    await next();
  });
  hono.use(
    "*",
    scimConnectionRateLimit((c) => c.get("connectionId") || undefined, counter),
  );
  hono.use("*", scimBodyLimit(64));
  hono.post("/Users", async (c) => c.json(await c.req.json(), 200));
  return hono;
}

describe("SCIM connection rate limit", () => {
  it("returns a SCIM 429 with Retry-After per connection, isolating other connections", async () => {
    const hono = app(new WindowCounter(2, 60_000));
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
    const limited = await call("c1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
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
  });
});

describe("SCIM body limit", () => {
  it("rejects a declared-oversized body with a SCIM 413 tooLarge", async () => {
    const hono = app(new WindowCounter(100, 60_000));
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
    const hono = app(new WindowCounter(100, 60_000));
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
