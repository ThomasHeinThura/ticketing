import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { IMPORT_SOURCE_BODY_LIMIT_BYTES } from "../../../apps/api/src/imports/engine/body-limit";
import {
  createMemoryIdempotencyStore,
  IDEMPOTENCY_RESPONSE_TTL_MS,
  idempotencyKeyMiddleware,
  idempotencyRequestHash,
} from "../../../apps/api/src/middleware/idempotency";

type Vars = { userId: string; apiKey?: { id: string } };

let clock = 0;
let store: ReturnType<typeof createMemoryIdempotencyStore>;
let calls = 0;
let nextStatus: 202 | 409 = 202;
let gate: Promise<void> | undefined;

function app() {
  const router = new Hono<{ Variables: Vars }>();
  router.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user") ?? "user-1");
    const key = c.req.header("x-test-key");
    if (key) c.set("apiKey", { id: key });
    await next();
  });
  const handler = async (c: import("hono").Context) => {
    calls += 1;
    if (gate) await gate;
    if (nextStatus === 409)
      return c.json({ message: "pending_approval: pa-existing" }, 409);
    return c.json(
      {
        pendingActionId: `pa-${calls}`,
        action: "delete",
        confirmation: "click",
      },
      202,
    );
  };
  const idempotency = idempotencyKeyMiddleware({ store });
  router.delete("/api/work-items/:key", idempotency, handler);
  router.post("/api/work-items/bulk-delete", idempotency, handler);
  return router;
}

function del(path: string, headers: Record<string, string> = {}) {
  return app().request(path, { method: "DELETE", headers });
}

beforeEach(() => {
  clock = 1_000_000;
  store = createMemoryIdempotencyStore(() => clock);
  calls = 0;
  nextStatus = 202;
  gate = undefined;
});

describe("Idempotency-Key middleware for 202 pending-action requests", () => {
  it("passes requests without the header straight through", async () => {
    const first = await del("/api/work-items/SUP-1");
    const second = await del("/api/work-items/SUP-1");
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(calls).toBe(2);
    expect(store.size()).toBe(0);
  });

  it("replays the stored 202 for the same key and request without reaching the handler", async () => {
    const r = new Hono<{ Variables: Vars }>();
    r.use("*", async (c, next) => {
      c.set("userId", "user-1");
      await next();
    });
    r.delete(
      "/api/work-items/:key",
      idempotencyKeyMiddleware({ store }),
      async (c) => {
        calls += 1;
        return c.json({ pendingActionId: `pa-${calls}` }, 202);
      },
    );
    const headers = { "Idempotency-Key": "retry-1" };
    const first = await r.request("/api/work-items/SUP-1", {
      method: "DELETE",
      headers,
    });
    const second = await r.request("/api/work-items/SUP-1", {
      method: "DELETE",
      headers,
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(calls).toBe(1);
  });

  it("rejects the same key reused for a different request with 422", async () => {
    const headers = { "Idempotency-Key": "retry-2" };
    expect((await del("/api/work-items/SUP-1", headers)).status).toBe(202);
    const reused = await del("/api/work-items/SUP-2", headers);
    expect(reused.status).toBe(422);
    expect(await reused.text()).toContain("idempotency_key_reused");
    expect(calls).toBe(1);
  });

  it("rejects the same key with a different body with 422", async () => {
    const send = (body: string) =>
      app().request("/api/work-items/bulk-delete", {
        method: "POST",
        headers: {
          "Idempotency-Key": "bulk-1",
          "content-type": "application/json",
        },
        body,
      });
    expect((await send('{"keys":["SUP-1"]}')).status).toBe(202);
    expect((await send('{"keys":["SUP-1"]}')).status).toBe(202);
    expect((await send('{"keys":["SUP-2"]}')).status).toBe(422);
    expect(calls).toBe(1);
  });

  it("scopes keys per actor so one caller never replays another's response", async () => {
    const key = { "Idempotency-Key": "shared" };
    await del("/api/work-items/SUP-1", { ...key, "x-test-user": "user-1" });
    const other = await del("/api/work-items/SUP-1", {
      ...key,
      "x-test-user": "user-2",
    });
    const viaApiKey = await del("/api/work-items/SUP-1", {
      ...key,
      "x-test-user": "user-1",
      "x-test-key": "key-1",
    });
    expect(other.headers.get("idempotent-replayed")).toBeNull();
    expect(viaApiKey.headers.get("idempotent-replayed")).toBeNull();
    expect(calls).toBe(3);
  });

  it("answers 409 for a duplicate that arrives while the first is in flight", async () => {
    let open: () => void = () => {};
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const headers = { "Idempotency-Key": "concurrent" };
    const first = del("/api/work-items/SUP-1", headers);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const duplicate = await del("/api/work-items/SUP-1", headers);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toContain("idempotency_key_in_flight");
    open();
    expect((await first).status).toBe(202);
    expect(calls).toBe(1);
  });

  it("releases the key when the request did not succeed, so a retry runs again", async () => {
    nextStatus = 409;
    const headers = { "Idempotency-Key": "after-conflict" };
    expect((await del("/api/work-items/SUP-1", headers)).status).toBe(409);
    expect(store.size()).toBe(0);
    nextStatus = 202;
    const retry = await del("/api/work-items/SUP-1", headers);
    expect(retry.status).toBe(202);
    expect(retry.headers.get("idempotent-replayed")).toBeNull();
    expect(calls).toBe(2);
  });

  it("forgets a stored response after 24 hours", async () => {
    const headers = { "Idempotency-Key": "day-old" };
    await del("/api/work-items/SUP-1", headers);
    clock += IDEMPOTENCY_RESPONSE_TTL_MS - 1;
    expect(
      (await del("/api/work-items/SUP-1", headers)).headers.get(
        "idempotent-replayed",
      ),
    ).toBe("true");
    clock += 1;
    const fresh = await del("/api/work-items/SUP-1", headers);
    expect(fresh.headers.get("idempotent-replayed")).toBeNull();
    expect(calls).toBe(2);
  });

  it.each(["", "has space", "x".repeat(256), "naïve"])(
    "rejects a malformed key %#",
    async (key) => {
      const response = await del("/api/work-items/SUP-1", {
        "Idempotency-Key": key,
      });
      expect(response.status).toBe(400);
      expect(calls).toBe(0);
    },
  );

  it("hashes method, path, query and body", () => {
    const base = {
      method: "DELETE",
      path: "/api/work-items/SUP-1",
      search: "",
      body: new Uint8Array(),
    };
    const hash = idempotencyRequestHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyRequestHash({ ...base, method: "delete" })).toBe(hash);
    expect(idempotencyRequestHash({ ...base, search: "?force=1" })).not.toBe(
      hash,
    );
    expect(
      idempotencyRequestHash({ ...base, body: new Uint8Array([1]) }),
    ).not.toBe(hash);
  });
});

describe("Idempotency-Key stores every 2xx except secret-bearing routes", () => {
  function secretApp(path: string, status: 200 | 201) {
    const router = new Hono<{ Variables: Vars }>();
    router.use("*", async (c, next) => {
      c.set("userId", "user-1");
      await next();
    });
    let runs = 0;
    router.post(path, idempotencyKeyMiddleware({ store }), (c) => {
      runs += 1;
      return c.json({ value: `v-${runs}` }, status);
    });
    const send = () =>
      router.request(path, {
        method: "POST",
        headers: { "idempotency-key": "k-1" },
      });
    return { send, runs: () => runs };
  }

  it("replays a keyed POST create (201) instead of running it twice", async () => {
    const t = secretApp("/api/work-items/SUP-1/comments", 201);
    const first = await t.send();
    const second = await t.send();
    expect(await first.json()).toEqual({ value: "v-1" });
    expect(await second.json()).toEqual({ value: "v-1" });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(t.runs()).toBe(1);
  });

  it.each([
    "/api/me/step-up/challenges",
    "/api/instance/identity-connections/c1/scim/rotate-token",
    "/api/instance/observability/metrics-token/rotate",
    "/api/work-items/SUP-1/attachments/presign",
  ])("never stores or replays %s; a keyed retry runs again", async (path) => {
    const t = secretApp(path, 200);
    const first = await t.send();
    const second = await t.send();
    expect(await first.json()).toEqual({ value: "v-1" });
    expect(await second.json()).toEqual({ value: "v-2" });
    expect(second.headers.get("idempotent-replayed")).toBeNull();
    expect(t.runs()).toBe(2);
  });
});

describe("Idempotency-Key body cap on routes that take a large body", () => {
  const LIMIT = IMPORT_SOURCE_BODY_LIMIT_BYTES;

  function bodyApp() {
    const router = new Hono<{ Variables: Vars }>();
    router.use("*", async (c, next) => {
      c.set("userId", "user-1");
      await next();
    });
    let runs = 0;
    const idempotency = idempotencyKeyMiddleware({ store });
    const handler = async (c: import("hono").Context) => {
      runs += 1;
      return c.json({ bytes: (await c.req.arrayBuffer()).byteLength }, 200);
    };
    router.post("/api/import-sources", idempotency, handler);
    router.post("/api/work-items/bulk", idempotency, handler);
    return { router, runs: () => runs };
  }

  /** A body of `total` bytes that records how much of it was actually pulled. */
  function stream(total: number) {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) return controller.close();
        const size = Math.min(chunk.length, total - sent);
        sent += size;
        controller.enqueue(chunk.subarray(0, size));
      },
    });
    return { body, pulled: () => sent };
  }

  it("refuses an oversize Content-Length with 413 before reading anything or taking the key", async () => {
    const t = bodyApp();
    const { body, pulled } = stream(LIMIT + 1);
    const response = await t.router.request(
      new Request("http://localhost/api/import-sources", {
        method: "POST",
        headers: {
          "idempotency-key": "k-big",
          "content-length": String(LIMIT + 1),
        },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      message: "Request body too large",
    });
    expect(t.runs()).toBe(0);
    // Only the stream's own eager first chunk: nothing was read on behalf of the middleware.
    expect(pulled()).toBeLessThanOrEqual(2 * 1024 * 1024);
    // The key was never reserved: the same key works for a legitimate body.
    const retry = await t.router.request(
      "http://localhost/api/import-sources",
      {
        method: "POST",
        headers: { "idempotency-key": "k-big" },
        body: "{}",
      },
    );
    expect(retry.status).toBe(200);
  });

  it("cuts off a body with no declared length as soon as it passes the cap", async () => {
    const t = bodyApp();
    const total = LIMIT * 4;
    const { body, pulled } = stream(total);
    const response = await t.router.request(
      new Request("http://localhost/api/import-sources", {
        method: "POST",
        headers: { "idempotency-key": "k-chunked" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(t.runs()).toBe(0);
    // Read to just past the cap, never the whole 80 MiB.
    expect(pulled()).toBeLessThan(LIMIT + 4 * 1024 * 1024);
  });

  it("keeps full idempotency semantics for an in-limit body on the capped route", async () => {
    const t = bodyApp();
    const send = () =>
      t.router.request("http://localhost/api/import-sources", {
        method: "POST",
        headers: { "idempotency-key": "k-ok" },
        body: "x".repeat(1024),
      });
    const first = await send();
    const second = await send();
    expect(await first.json()).toEqual({ bytes: 1024 });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(t.runs()).toBe(1);
  });

  it("does not cap any other route (unchanged behaviour)", async () => {
    const t = bodyApp();
    const response = await t.router.request(
      "http://localhost/api/work-items/bulk",
      {
        method: "POST",
        headers: { "idempotency-key": "k-other" },
        body: "x".repeat(LIMIT + 1024),
      },
    );
    expect(response.status).toBe(200);
    expect(t.runs()).toBe(1);
  });
});
