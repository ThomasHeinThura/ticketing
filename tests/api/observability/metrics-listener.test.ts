import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import {
  createMetricsListener,
  METRICS_LISTENER_MANIFEST,
} from "../../../apps/api/src/observability/metrics-listener.js";

function makeToken(fill: number): { token: string; digest: Buffer } {
  const bytes = Buffer.alloc(32, fill);
  return {
    token: bytes.toString("base64url"),
    digest: createHash("sha256").update(bytes).digest(),
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function call(
  port: number,
  options: {
    method?: string;
    path?: string;
    authorization?: string | string[];
  } = {},
): Promise<{
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const url = new URL("http://127.0.0.1");
    url.port = String(port);
    url.pathname = options.path?.split("?")[0] ?? "/metrics";
    url.search = options.path?.includes("?")
      ? `?${options.path.split("?").slice(1).join("?")}`
      : "";
    const request = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        headers:
          typeof options.authorization === "string"
            ? { authorization: options.authorization }
            : options.authorization?.flatMap((value) => [
                "Authorization",
                value,
              ]),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function digestBearer(token: string) {
  const bytes = Buffer.from(token, "base64url");
  return createHash("sha256").update(bytes).digest();
}

describe("internal metrics listener", () => {
  it("exports the fixed production manifest and performs no bind during construction", async () => {
    expect(METRICS_LISTENER_MANIFEST).toEqual({
      port: 9464,
      method: "GET",
      path: "/metrics",
      policyKey: "GET /metrics",
    });
    const port = await freePort();
    const listener = createMetricsListener({
      testPort: port,
      readCurrentTokenDigest: async () => null,
      renderMetrics: () => "metrics\n",
    });
    await expect(call(port)).rejects.toBeTruthy();
    await listener.start();
    expect((await call(port)).status).toBe(401);
    await listener.stop();
    await expect(call(port)).rejects.toBeTruthy();
  });

  it("allows only exact GET /metrics, rereads credentials for every scrape, and revokes old tokens", async () => {
    const port = await freePort();
    const first = makeToken(41);
    const next = makeToken(42);
    let current: Uint8Array | null = first.digest;
    let reads = 0;
    let expositions = 0;
    const listener = createMetricsListener(
      {
        testPort: port,
        readCurrentTokenDigest: async () => {
          reads += 1;
          return current;
        },
        renderMetrics: () => {
          expositions += 1;
          return "taskdesk_http_in_flight 0\n";
        },
      },
      "text/plain; version=0.0.4; charset=utf-8",
    );
    await listener.start();
    try {
      expect((await call(port, { method: "POST" })).status).toBe(405);
      expect(
        (await call(port, { method: "GET", path: "/metrics?x=1" })).status,
      ).toBe(404);
      expect(
        (await call(port, { method: "GET", path: "/private" })).status,
      ).toBe(404);
      expect((await call(port, { method: "HEAD" })).status).toBe(405);

      expect((await call(port)).status).toBe(401);
      expect((await call(port, { authorization: "Bearer bad" })).status).toBe(
        401,
      );
      const duplicated = await call(port, {
        authorization: [`Bearer ${first.token}`, `Bearer ${first.token}`],
      });
      // Node's parser rejects repeated Authorization fields before invoking the
      // request handler; the request is still denied before credential I/O.
      expect(duplicated.status).toBe(400);
      expect(reads).toBe(0);
      expect(expositions).toBe(0);

      const success = await call(port, {
        authorization: `Bearer ${first.token}`,
      });
      expect(success.status).toBe(200);
      expect(success.body).toBe("taskdesk_http_in_flight 0\n");
      expect(success.headers["cache-control"]).toBe("no-store");
      expect(success.headers["content-type"]).toContain("version=0.0.4");
      expect(reads).toBe(1);
      expect(expositions).toBe(1);

      current = next.digest;
      expect(
        (await call(port, { authorization: `Bearer ${first.token}` })).status,
      ).toBe(401);
      expect(
        (await call(port, { authorization: `Bearer ${next.token}` })).status,
      ).toBe(200);
      expect(reads).toBe(3);
      expect(expositions).toBe(2);
    } finally {
      await listener.stop();
    }
  });

  it("returns generic 503 on digest-store failure and does not expose metrics", async () => {
    const port = await freePort();
    const token = makeToken(43);
    let expositions = 0;
    const listener = createMetricsListener({
      testPort: port,
      readCurrentTokenDigest: async () => {
        throw new Error("database password and stack must not be returned");
      },
      renderMetrics: () => {
        expositions += 1;
        return "secret metric payload\n";
      },
    });
    await listener.start();
    try {
      const response = await call(port, {
        authorization: `Bearer ${token.token}`,
      });
      expect(response.status).toBe(503);
      expect(response.body).toBe("Metrics unavailable\n");
      expect(response.body).not.toContain("password");
      expect(response.body).not.toContain("stack");
      expect(expositions).toBe(0);
    } finally {
      await listener.stop();
    }
  });

  it("rejects a bind collision and allows a stopped listener port to be reclaimed", async () => {
    const port = await freePort();
    const occupied: Server = createServer();
    occupied.listen(port, "0.0.0.0");
    await once(occupied, "listening");

    const listener = createMetricsListener({
      testPort: port,
      readCurrentTokenDigest: async () => null,
      renderMetrics: () => "",
    });
    await expect(listener.start()).rejects.toBeTruthy();
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );

    await listener.start();
    await listener.stop();
    const reclaimed = createServer();
    reclaimed.listen(port, "127.0.0.1");
    await once(reclaimed, "listening");
    await new Promise<void>((resolve, reject) =>
      reclaimed.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("accepts only canonical 43-character base64url tokens", async () => {
    const port = await freePort();
    const token = makeToken(44);
    let reads = 0;
    const listener = createMetricsListener({
      testPort: port,
      readCurrentTokenDigest: async () => {
        reads += 1;
        return digestBearer(token.token);
      },
      renderMetrics: () => "ok\n",
    });
    await listener.start();
    try {
      const malformed = await call(port, {
        authorization: `Bearer ${token.token.slice(0, -1)}=`,
      });
      expect(malformed.status).toBe(401);
      expect(reads).toBe(0);
      expect(
        (await call(port, { authorization: `Bearer ${token.token}` })).status,
      ).toBe(200);
      expect(reads).toBe(1);
    } finally {
      await listener.stop();
    }
  });
});
