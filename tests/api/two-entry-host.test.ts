import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDatabasePool } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";

const requireFromApi = createRequire(
  fileURLToPath(new URL("../../apps/api/package.json", import.meta.url)),
);
type HonoFetch = (
  request: Request,
  env?: unknown,
  executionCtx?: unknown,
) => Response | Promise<Response>;
const { getRequestListener } = requireFromApi("@hono/node-server") as {
  getRequestListener: (fetch: HonoFetch) => RequestListener;
};

describe("P0 host and static isolation", () => {
  let agentRoot: string;
  let portalRoot: string;

  beforeAll(() => {
    agentRoot = mkdtempSync(join(tmpdir(), "taskdesk-host-agent-"));
    portalRoot = mkdtempSync(join(tmpdir(), "taskdesk-host-portal-"));
    mkdirSync(join(agentRoot, "assets"));
    mkdirSync(join(portalRoot, "assets"));
    writeFileSync(
      join(agentRoot, "index.html"),
      "<!doctype html><title>AGENT ROOT MARKER</title>",
    );
    writeFileSync(
      join(agentRoot, "assets", "only-agent.js"),
      "AGENT ASSET MARKER",
    );
    writeFileSync(
      join(portalRoot, "index.html"),
      "<!doctype html><title>PORTAL ROOT MARKER</title>",
    );
    writeFileSync(
      join(portalRoot, "assets", "only-portal.js"),
      "PORTAL ASSET MARKER",
    );
  });

  afterAll(() => {
    rmSync(agentRoot, { recursive: true, force: true });
    rmSync(portalRoot, { recursive: true, force: true });
  });

  it("serves direct root and assets from exactly the Host-selected tree", async () => {
    const { app } = createApp({
      staticRoot: agentRoot,
      portalStaticRoot: portalRoot,
    });
    const scenarios: Array<readonly [string, string, string, string]> = [
      [
        "localhost:5173",
        "AGENT ROOT MARKER",
        "only-agent.js",
        "only-portal.js",
      ],
      [
        "portal.localhost:5174",
        "PORTAL ROOT MARKER",
        "only-portal.js",
        "only-agent.js",
      ],
    ];
    for (const [host, marker, ownAsset, foreignAsset] of scenarios) {
      const headers = { host };
      const root = await app.request("/", { headers });
      expect(root.status).toBe(200);
      await expect(root.text()).resolves.toContain(marker);
      const asset = await app.request(`/assets/${ownAsset}`, { headers });
      expect(asset.status).toBe(200);
      const hidden = await app.request(`/assets/${foreignAsset}`, { headers });
      expect(hidden.status).toBe(404);
      await expect(hidden.text()).resolves.not.toContain("MARKER");
      const head = await app.request("/", { method: "HEAD", headers });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
  });

  it("keeps portal extensionless paths and missing assets at 404 without agent fallback", async () => {
    const { app } = createApp({
      staticRoot: agentRoot,
      portalStaticRoot: portalRoot,
    });
    const headers = { host: "portal.localhost:5174" };
    for (const path of ["/portal/not-a-route", "/assets/missing.js"]) {
      const response = await app.request(path, { headers });
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.not.toContain("AGENT ROOT MARKER");
    }
  });

  it("denies portal API and websocket before effects and keeps health narrowly host-independent", async () => {
    const { app } = createApp({
      staticRoot: agentRoot,
      portalStaticRoot: portalRoot,
    });
    const query = vi
      .spyOn(getDatabasePool(), "query")
      .mockRejectedValue(
        new Error("Host-denied requests must not reach the database."),
      );
    try {
      const portalApi = await app.request("/api/workspaces", {
        method: "POST",
        headers: {
          host: "portal.localhost:5174",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "must-not-exist" }),
      });
      expect(portalApi.status).toBe(404);
      expect(await portalApi.text()).toBe('{"message":"Not Found"}');
      expect(portalApi.headers.has("set-cookie")).toBe(false);

      const portalAuth = await app.request("/api/auth/get-session", {
        headers: { host: "portal.localhost:5174" },
      });
      expect(portalAuth.status).toBe(404);
      expect(portalAuth.headers.has("set-cookie")).toBe(false);

      const portalWs = await app.request("/api/ws/project", {
        headers: {
          host: "portal.localhost:5174",
          upgrade: "websocket",
          connection: "Upgrade",
        },
      });
      expect(portalWs.status).toBe(404);

      const unknownHealth = await app.request("/api/public/health/live", {
        headers: { host: "unknown.example.test" },
      });
      expect(unknownHealth.status).toBe(200);
      const unknownHead = await app.request("/api/public/health/live", {
        method: "HEAD",
        headers: { host: "unknown.example.test" },
      });
      expect(unknownHead.status).toBe(200);
      expect(await unknownHead.text()).toBe("");

      const unknownApi = await app.request("/api/workspaces", {
        headers: { host: "unknown.example.test" },
      });
      expect(unknownApi.status).toBe(404);

      const spoofedHost = await app.request(
        new Request("http://attacker.example.test/api/workspaces", {
          headers: {
            "x-forwarded-host": "localhost:5173",
            "x-forwarded-proto": "https",
          },
        }),
      );
      expect(spoofedHost.status).toBe(404);

      const unknownUpgrade = await app.request("/api/public/health/live", {
        headers: {
          host: "unknown.example.test",
          upgrade: "websocket",
          connection: "Upgrade",
        },
      });
      expect(unknownUpgrade.status).toBe(404);

      for (const host of ["localhost:5173", "portal.localhost:5174"]) {
        const health = await app.request("/api/public/health/live", {
          headers: { host },
        });
        expect(health.status).toBe(200);
        const head = await app.request("/api/public/health/live", {
          method: "HEAD",
          headers: { host },
        });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");
      }

      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });

  it("rejects shared cookie domains at application startup", () => {
    const original = process.env.COOKIE_DOMAIN;
    process.env.COOKIE_DOMAIN = ".example.test";
    try {
      expect(() =>
        createApp({ staticRoot: agentRoot, portalStaticRoot: portalRoot }),
      ).toThrow(/COOKIE_DOMAIN is incompatible/u);
    } finally {
      if (original === undefined) delete process.env.COOKIE_DOMAIN;
      else process.env.COOKIE_DOMAIN = original;
    }
  });

  it("returns 503 for a selected origin whose static root is missing", async () => {
    const { app } = createApp({
      staticRoot: agentRoot,
      portalStaticRoot: join(tmpdir(), "absent-portal-output-root"),
    });
    const response = await app.request("/", {
      headers: { host: "portal.localhost:5174" },
    });
    expect(response.status).toBe(503);
  });

  it("rejects repeated raw Host fields at the actual Node HTTP boundary", async () => {
    const { app } = createApp({
      staticRoot: agentRoot,
      portalStaticRoot: portalRoot,
    });
    const server = createServer(
      getRequestListener(app.fetch as unknown as HonoFetch),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a TCP listener.");
    try {
      const exchange = (request: string) =>
        new Promise<string>((resolve, reject) => {
          const socket = connect(address.port, "127.0.0.1");
          let raw = "";
          socket.setEncoding("utf8");
          socket.on("data", (chunk) => {
            raw += chunk;
          });
          socket.on("error", reject);
          socket.on("end", () => resolve(raw));
          socket.on("connect", () => socket.write(request));
        });

      const response = await exchange(
        "GET /api/workspaces HTTP/1.1\r\nHost: localhost:5173\r\nHost: portal.localhost:5174\r\nConnection: close\r\n\r\n",
      );
      expect(response).toMatch(/^HTTP\/1\.1 (?:400|404)\b/u);
      expect(response).not.toContain("PORTAL ROOT MARKER");
      expect(response).not.toContain("AGENT ROOT MARKER");

      const loopbackHost = `127.0.0.1:${address.port}`;
      const loopbackHealth = await exchange(
        `GET /api/public/health/live HTTP/1.1\r\nHost: ${loopbackHost}\r\nConnection: close\r\n\r\n`,
      );
      expect(loopbackHealth).toMatch(/^HTTP\/1\.1 200\b/u);

      const loopbackHead = await exchange(
        `HEAD /api/public/health/live HTTP/1.1\r\nHost: ${loopbackHost}\r\nConnection: close\r\n\r\n`,
      );
      expect(loopbackHead).toMatch(/^HTTP\/1\.1 200\b/u);
      expect(loopbackHead.split("\r\n\r\n").at(1) ?? "").toBe("");

      const loopbackApi = await exchange(
        `GET /api/workspaces HTTP/1.1\r\nHost: ${loopbackHost}\r\nConnection: close\r\n\r\n`,
      );
      expect(loopbackApi).toMatch(/^HTTP\/1\.1 404\b/u);

      const malformedHost = await exchange(
        "GET /api/public/health/live HTTP/1.1\r\nHost: malformed host\r\nConnection: close\r\n\r\n",
      );
      expect(malformedHost).toMatch(/^HTTP\/1\.1 400\b/u);

      const missingHost = await exchange(
        "GET /api/public/health/live HTTP/1.1\r\nConnection: close\r\n\r\n",
      );
      expect(missingHost).toMatch(/^HTTP\/1\.1 400\b/u);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
