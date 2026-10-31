import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { IMPORT_SOURCE_BODY_LIMIT_BYTES } from "../../../apps/api/src/imports/engine/body-limit";
import {
  API_DEFAULT_BODY_LIMIT_BYTES,
  AUTH_BODY_LIMIT_BYTES,
  apiBodyLimitFor,
  apiBodyLimitMiddleware,
  BodyLimitError,
  idempotencyBodyLimit,
} from "../../../apps/api/src/middleware/body-limits";
import {
  createMemoryIdempotencyStore,
  idempotencyKeyMiddleware,
} from "../../../apps/api/src/middleware/idempotency";
import {
  SEARCH_BODY_MAX_BYTES,
  searchBodyLimit,
} from "../../../apps/api/src/work-item/search/query";

const KIB = 1024;
const MIB = 1024 * KIB;

describe("issue #704: the /api request-body limit table", () => {
  it("matches the limits the owner approved", () => {
    expect(AUTH_BODY_LIMIT_BYTES).toBe(64 * KIB);
    expect(API_DEFAULT_BODY_LIMIT_BYTES).toBe(10 * MIB);
    expect(IMPORT_SOURCE_BODY_LIMIT_BYTES).toBe(20 * MIB);
  });

  it.each([
    ["POST", "/api/auth/sign-in/email", 64 * KIB],
    ["POST", "/api/auth", 64 * KIB],
    ["PUT", "/api/auth/anything/deeper", 64 * KIB],
    ["post", "/api/import-sources", 20 * MIB],
    ["POST", "/api/import-sources/", 10 * MIB],
    ["PUT", "/api/storage/filesystem-upload/", 10 * MIB],
    ["PUT", "/api/storage/filesystem-upload", "exempt"],
    ["PUT", "/api/storage/filesystem-attachment-upload", "exempt"],
    // Exemptions and the import limit are exact method + exact path, never a prefix.
    ["POST", "/api/storage/filesystem-upload", 10 * MIB],
    ["PUT", "/api/storage/filesystem-upload/extra", 10 * MIB],
    ["PUT", "/api/storage/filesystem-uploads", 10 * MIB],
    ["PATCH", "/api/import-sources", 10 * MIB],
    ["POST", "/api/import-sources/abc/run", 10 * MIB],
    ["POST", "/api/authx", 10 * MIB],
    ["POST", "/api/authorizations", 10 * MIB],
    ["POST", "/api/work-items/search", 10 * MIB],
    ["POST", "/api", 10 * MIB],
    // Outside /api: SCIM and static serving have their own handling.
    ["POST", "/scim/v2/Users", undefined],
    ["POST", "/apix", undefined],
    ["POST", "/", undefined],
  ] as const)("%s %s → %s", (method, path, expected) => {
    expect(apiBodyLimitFor(method, path)).toBe(expected);
  });

  it("gives the idempotency layer a cap only where a route accepts more than the default", () => {
    expect(idempotencyBodyLimit("POST", "/api/import-sources")).toBe(
      IMPORT_SOURCE_BODY_LIMIT_BYTES,
    );
    expect(
      idempotencyBodyLimit("POST", "/api/work-items/bulk"),
    ).toBeUndefined();
    expect(
      idempotencyBodyLimit("POST", "/api/auth/sign-in/email"),
    ).toBeUndefined();
    expect(
      idempotencyBodyLimit("PUT", "/api/storage/filesystem-upload"),
    ).toBeUndefined();
  });
});

/** A body of `total` bytes that records how much of it was actually pulled. */
function stream(total: number) {
  const chunk = new Uint8Array(256 * KIB);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= total) return controller.close();
        const size = Math.min(chunk.length, total - sent);
        sent += size;
        controller.enqueue(chunk.subarray(0, size));
      },
    },
    // No eager read: `pulled()` counts exactly what a consumer asked for.
    { highWaterMark: 0 },
  );
  return { body, pulled: () => sent };
}

function request(
  method: string,
  path: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

function app() {
  const router = new Hono();
  let runs = 0;
  router.onError((err, c) =>
    err instanceof HTTPException
      ? err.getResponse()
      : c.json({ message: "Internal Server Error" }, 500),
  );
  router.use("*", apiBodyLimitMiddleware);
  router.use("*", async (c, next) => {
    c.set("userId" as never, "user-1" as never);
    await next();
  });
  const idempotency = idempotencyKeyMiddleware({
    store: createMemoryIdempotencyStore(),
  });
  router.all("*", idempotency, async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    // Counted only once the whole body was read: a capped body never gets here.
    runs += 1;
    return c.json({ bytes: bytes.byteLength, first: bytes[0] ?? null }, 200);
  });
  return { router, runs: () => runs };
}

describe("issue #704: apiBodyLimitMiddleware", () => {
  it("refuses an oversize Content-Length on /api/auth/* with a plain-text 413 before reading", async () => {
    const t = app();
    const { body, pulled } = stream(AUTH_BODY_LIMIT_BYTES + 1);
    const response = await t.router.request(
      request("POST", "/api/auth/sign-in/email", body, {
        "content-length": String(AUTH_BODY_LIMIT_BYTES + 1),
        "content-type": "application/json",
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
    expect(t.runs()).toBe(0);
    expect(pulled()).toBe(0);
  });

  it("cuts off a chunked /api/auth/* body as soon as it passes 64 KiB", async () => {
    const t = app();
    const { body, pulled } = stream(5 * MIB);
    const response = await t.router.request(
      request("POST", "/api/auth/sign-up/email", body),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
    expect(t.runs()).toBe(0);
    expect(pulled()).toBeLessThan(MIB);
  });

  it("passes a chunked body at the limit through intact, including to the idempotency hash", async () => {
    const t = app();
    const { body } = stream(AUTH_BODY_LIMIT_BYTES);
    const response = await t.router.request(
      request("POST", "/api/auth/sign-in/email", body, {
        "idempotency-key": "k-1",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      bytes: AUTH_BODY_LIMIT_BYTES,
      first: 0,
    });
  });

  it("delivers JSON parsed downstream through the counting stream", async () => {
    const router = new Hono();
    router.use("*", apiBodyLimitMiddleware);
    router.post("*", async (c) => c.json(await c.req.json()));
    const payload = new TextEncoder().encode(JSON.stringify({ a: "b" }));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    const response = await router.request(
      request("POST", "/api/work-items", body, {
        "content-type": "application/json",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ a: "b" });
  });

  it("applies the 10 MiB default everywhere else under /api", async () => {
    const t = app();
    const over = await t.router.request(
      request("POST", "/api/work-items", stream(10 * MIB + 1).body, {
        "content-length": String(10 * MIB + 1),
      }),
    );
    expect(over.status).toBe(413);
    expect(await over.text()).toBe("Payload too large");
    const chunked = await t.router.request(
      request("PATCH", "/api/work-items/x", stream(10 * MIB + 1).body),
    );
    expect(chunked.status).toBe(413);
    const under = await t.router.request(
      request(
        "POST",
        "/api/work-items",
        stream(AUTH_BODY_LIMIT_BYTES * 2).body,
      ),
    );
    expect(under.status).toBe(200);
    expect(t.runs()).toBe(1);
  });

  it("keeps the import-source route's JSON 413 and its 20 MiB allowance", async () => {
    const t = app();
    const over = await t.router.request(
      request("POST", "/api/import-sources", stream(20 * MIB + 1).body, {
        "content-length": String(20 * MIB + 1),
      }),
    );
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ message: "Request body too large" });
    const chunkedOver = await t.router.request(
      request("POST", "/api/import-sources", stream(20 * MIB + 1).body),
    );
    expect(chunkedOver.status).toBe(413);
    expect(await chunkedOver.json()).toEqual({
      message: "Request body too large",
    });
    const under = await t.router.request(
      request("POST", "/api/import-sources", stream(12 * MIB).body),
    );
    expect(under.status).toBe(200);
    expect(await under.json()).toMatchObject({ bytes: 12 * MIB });
  });

  it("never buffers or caps the two raw upload streams", async () => {
    const t = app();
    for (const path of [
      "/api/storage/filesystem-upload",
      "/api/storage/filesystem-attachment-upload",
    ]) {
      const declared = await t.router.request(
        request("PUT", path, stream(11 * MIB).body, {
          "content-length": String(11 * MIB),
        }),
      );
      expect(declared.status).toBe(200);
      const chunked = await t.router.request(
        request("PUT", path, stream(11 * MIB).body),
      );
      expect(chunked.status).toBe(200);
      expect(await chunked.json()).toMatchObject({ bytes: 11 * MIB });
    }
  });

  it("reads nothing from a chunked body when an auth guard refuses the request first", async () => {
    const router = new Hono();
    router.use("*", apiBodyLimitMiddleware);
    router.use("/api/*", async (c) => c.json({ message: "Unauthorized" }, 401));
    router.post("/api/work-items", async (c) => c.json(await c.req.json()));
    const { body, pulled } = stream(50 * MIB);
    const response = await router.request(
      request("POST", "/api/work-items", body),
    );
    expect(response.status).toBe(401);
    expect(pulled()).toBe(0);
  });

  it("pulls a chunked body only as fast as the reader consumes it", async () => {
    const router = new Hono();
    router.use("*", apiBodyLimitMiddleware);
    let seen = -1;
    let pulledAtFirstChunk = -1;
    const source = stream(4 * MIB);
    router.post("/api/x", async (c) => {
      const reader = c.req.raw.body?.getReader();
      seen = source.pulled();
      await reader?.read();
      pulledAtFirstChunk = source.pulled();
      await reader?.cancel();
      return c.json({ ok: true });
    });
    const response = await router.request(
      request("POST", "/api/x", source.body),
    );
    expect(response.status).toBe(200);
    expect(seen).toBe(0);
    expect(pulledAtFirstChunk).toBe(256 * KIB);
  });

  it("raises BodyLimitError in the reader and still answers 413 when the reader swallows it", async () => {
    const router = new Hono();
    router.use("*", apiBodyLimitMiddleware);
    let caught: unknown;
    router.post("/api/auth/sign-in/email", async (c) => {
      try {
        await c.req.json();
      } catch (error) {
        caught = error;
        c.header("set-cookie", "leak=1");
        return c.json({ message: "Malformed JSON" }, 400);
      }
      return c.json({ ok: true });
    });
    const response = await router.request(
      request("POST", "/api/auth/sign-in/email", stream(MIB).body, {
        "content-type": "application/json",
      }),
    );
    expect(caught).toBeInstanceOf(BodyLimitError);
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
    // The downstream response's headers do not leak into the 413.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps headers set before it (CORS) on a 413 that replaces the downstream response", async () => {
    const router = new Hono();
    router.use("*", async (c, next) => {
      c.res.headers.set("access-control-allow-origin", "https://agent.test");
      await next();
    });
    router.use("*", apiBodyLimitMiddleware);
    router.post("/api/x", async (c) => {
      await c.req.arrayBuffer();
      return c.json({ ok: true });
    });
    const response = await router.request(
      request("POST", "/api/x", stream(11 * MIB).body),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://agent.test",
    );
  });

  it("answers 413 when an unhandled BodyLimitError reaches the app error handler", async () => {
    const t = app();
    const response = await t.router.request(
      request("POST", "/api/import-sources", stream(21 * MIB).body),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      message: "Request body too large",
    });
  });

  it("lets multipart parsing work on a chunked body under the limit", async () => {
    const router = new Hono();
    router.use("*", apiBodyLimitMiddleware);
    router.post("/api/x", async (c) => {
      const form = await c.req.parseBody();
      const file = form.file as File;
      return c.json({ name: form.name, size: file.size });
    });
    const form = new FormData();
    form.set("name", "report");
    form.set("file", new File([new Uint8Array(300 * KIB)], "a.bin"));
    const response = await router.request(
      new Request("http://localhost/api/x", { method: "POST", body: form }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "report", size: 300 * KIB });
  });

  it("refuses an oversize chunked multipart body with 413", async () => {
    const router = new Hono();
    router.onError((err, c) =>
      err instanceof HTTPException
        ? err.getResponse()
        : c.json({ message: "Internal Server Error" }, 500),
    );
    router.use("*", apiBodyLimitMiddleware);
    router.post("/api/auth/x", async (c) => c.json(await c.req.parseBody()));
    const form = new FormData();
    form.set("file", new File([new Uint8Array(65 * KIB)], "a.bin"));
    const response = await router.request(
      new Request("http://localhost/api/auth/x", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(413);
  });

  it("leaves paths outside /api untouched", async () => {
    const t = app();
    const response = await t.router.request(
      request("POST", "/scim/v2/Users", stream(11 * MIB).body, {
        "content-length": String(11 * MIB),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("work-item search document routes: 32 KiB limit without buffering first", () => {
  function searchApp() {
    const router = new Hono();
    router.onError((err, c) =>
      err instanceof HTTPException
        ? err.getResponse()
        : c.json({ message: "Internal Server Error" }, 500),
    );
    router.post("/search", searchBodyLimit(), async (c) =>
      c.json({ bytes: (await c.req.arrayBuffer()).byteLength }),
    );
    return router;
  }

  it("answers an oversize declared length with the documented 400 before reading", async () => {
    const { body, pulled } = stream(5 * MIB);
    const response = await searchApp().request(
      request("POST", "/search", body, {
        "content-length": String(5 * MIB),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Request body exceeds 32 KiB");
    expect(pulled()).toBeLessThanOrEqual(256 * KIB);
  });

  it("stops a chunked body as soon as it passes 32 KiB", async () => {
    const { body, pulled } = stream(5 * MIB);
    const response = await searchApp().request(
      request("POST", "/search", body),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Request body exceeds 32 KiB");
    expect(pulled()).toBeLessThan(MIB);
  });

  it("passes a body of exactly 32 KiB through intact", async () => {
    const response = await searchApp().request(
      request("POST", "/search", stream(SEARCH_BODY_MAX_BYTES).body),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: SEARCH_BODY_MAX_BYTES });
  });
});
