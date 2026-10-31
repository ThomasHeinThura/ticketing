import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiBodyLimitMiddleware } from "../../../apps/api/src/middleware/body-limits";

/**
 * Issue #704 at a real `@hono/node-server` socket: the body limit decides from headers alone and
 * reads the Node request only when a route does, so a request refused before reading its body
 * (the auth guard's 401) never reads a byte from the socket.
 */
const requireFromApi = createRequire(
  fileURLToPath(new URL("../../../apps/api/package.json", import.meta.url)),
);
type HonoFetch = (
  request: Request,
  env?: unknown,
) => Response | Promise<Response>;
const { getRequestListener } = requireFromApi("@hono/node-server") as {
  getRequestListener: (fetch: HonoFetch) => RequestListener;
};

type Env = { Bindings: { incoming: IncomingMessage } };

const KIB = 1024;
const MIB = 1024 * KIB;
const didRead: boolean[] = [];

function buildApp() {
  const app = new Hono<Env>();
  app.onError((err, c) =>
    err instanceof HTTPException
      ? err.getResponse()
      : c.json({ message: "Internal Server Error" }, 500),
  );
  app.use("*", apiBodyLimitMiddleware);
  // Stands in for the auth guard: refuses without reading the body.
  app.post("/api/guarded", async (c) => {
    // Give any eager reader time to start before measuring.
    await new Promise((resolve) => setTimeout(resolve, 50));
    didRead.push(c.env.incoming.readableDidRead);
    return c.json({ message: "Unauthorized" }, 401);
  });
  app.post("/api/read", async (c) =>
    c.json({ bytes: (await c.req.arrayBuffer()).byteLength }),
  );
  app.post("/api/auth/read", async (c) =>
    c.json({ bytes: (await c.req.arrayBuffer()).byteLength }),
  );
  // Better Auth style: a new Request over the raw one, cloned and read twice.
  app.post("/api/auth/echo", async (c) => {
    const request = new Request(c.req.raw, {
      headers: new Headers(c.req.raw.headers),
    });
    const copy = request.clone();
    const [first, second] = await Promise.all([request.text(), copy.text()]);
    return c.json({
      length: first.length,
      same: first === second,
      key: (JSON.parse(first) as { key: string }).key,
    });
  });
  return app;
}

let server: Server;
let port: number;

beforeAll(async () => {
  const app = buildApp();
  server = createServer(
    getRequestListener((request, env) => app.fetch(request, env as never)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Sends `body` with a Content-Length, or chunked in 16 KiB writes. */
function send(path: string, body: Buffer, chunked: boolean) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    let answered = false;
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(chunked ? {} : { "content-length": String(body.length) }),
        },
      },
      (res) => {
        answered = true;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    // The server may answer and close before the whole body is written.
    req.on("error", (error) => {
      if (!answered) reject(error);
    });
    if (!chunked) {
      req.end(body);
      return;
    }
    for (let offset = 0; offset < body.length; offset += 16 * KIB)
      req.write(body.subarray(offset, offset + 16 * KIB));
    req.end();
  });
}

describe("issue #704: body limit at a real @hono/node-server socket", () => {
  it("never reads the body of a request refused before reading, with a Content-Length", async () => {
    didRead.length = 0;
    const response = await send("/api/guarded", Buffer.alloc(MIB, 97), false);
    expect(response.status).toBe(401);
    expect(didRead).toEqual([false]);
  });

  it("never reads the body of a request refused before reading, chunked", async () => {
    didRead.length = 0;
    const response = await send("/api/guarded", Buffer.alloc(MIB, 97), true);
    expect(response.status).toBe(401);
    expect(didRead).toEqual([false]);
  });

  it("answers an oversize declared length with 413", async () => {
    const response = await send(
      "/api/auth/read",
      Buffer.alloc(64 * KIB + 1, 97),
      false,
    );
    expect(response.status).toBe(413);
    expect(response.text).toBe("Payload too large");
  });

  it("answers a chunked body that a route reads past the limit with 413", async () => {
    const response = await send(
      "/api/auth/read",
      Buffer.alloc(256 * KIB, 97),
      true,
    );
    expect(response.status).toBe(413);
    expect(response.text).toBe("Payload too large");
  });

  it("delivers a chunked body under the limit in full", async () => {
    const response = await send("/api/read", Buffer.alloc(3 * MIB, 97), true);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({ bytes: 3 * MIB });
  });

  it("keeps new Request(raw, { headers }) and clone() working on a chunked body", async () => {
    const payload = JSON.stringify({ key: "value", pad: "x".repeat(20 * KIB) });
    const response = await send(
      "/api/auth/echo",
      Buffer.from(payload, "utf8"),
      true,
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({
      length: payload.length,
      same: true,
      key: "value",
    });
  });
});
