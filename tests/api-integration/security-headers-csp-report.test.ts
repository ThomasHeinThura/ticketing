import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getConfiguredAgentOrigin } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  CSP_REPORT_MAX_BODY_BYTES,
  readCspReportDiagnosticCounters,
} from "../../apps/api/src/security-headers";
import { resetTestDatabase } from "./helpers/database";

const agentOrigin = getConfiguredAgentOrigin();
const agentHost = new URL(agentOrigin).host;

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing({ target: schema.instanceSettingTable.id });
});

function createRequestBody(
  app: ReturnType<typeof createApp>["app"],
  body: BodyInit,
  contentType: string,
) {
  return app.request(`${agentOrigin}/api/public/csp-report`, {
    method: "POST",
    headers: { host: agentHost, "content-type": contentType },
    body,
  });
}

describe("public CSP violation report endpoint", () => {
  it("serves complete nonced documents and anonymous PDF assets through the real static middleware", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "taskdesk-csp-static-"));
    const html =
      '<!doctype html><html><head><script type="module" src="/assets/pdf-preview/viewer.js"></script></head><body><canvas id="pdf-page"></canvas></body></html>';
    try {
      const agentRoot = path.join(root, "agent");
      const portalRoot = path.join(root, "portal");
      for (const directory of [agentRoot, portalRoot]) {
        await mkdir(path.join(directory, "assets/pdf-preview"), {
          recursive: true,
        });
        await writeFile(path.join(directory, "index.html"), html);
        await writeFile(path.join(directory, "pdf-preview.html"), html);
        await writeFile(
          path.join(directory, "assets/pdf-preview/viewer.js"),
          "export const viewer = true;",
        );
      }
      const { app } = createApp({
        staticRoot: agentRoot,
        portalStaticRoot: portalRoot,
      });
      const portalOrigin = process.env.TASKDESK_PORTAL_URL;
      if (!portalOrigin) throw new Error("Portal test origin is required");
      for (const origin of [agentOrigin, portalOrigin]) {
        const host = new URL(origin).host;
        for (const documentPath of ["/", "/pdf-preview.html"]) {
          const response = await app.request(`${origin}${documentPath}`, {
            headers: { host, "if-modified-since": new Date().toUTCString() },
          });
          expect(response.status).toBe(200);
          const body = await response.text();
          expect(body).toContain('<canvas id="pdf-page"></canvas>');
          expect(body).toContain("</body></html>");
          expect(body).toMatch(/<script nonce="[A-Za-z0-9_-]+"/);
          const length = response.headers.get("content-length");
          expect(
            length === null || Number(length) === Buffer.byteLength(body),
          ).toBe(true);
          expect(response.headers.get("last-modified")).toBeNull();
          expect(response.headers.get("etag")).toBeNull();
          expect(response.headers.get("cache-control")).toBe("no-store");
          const head = await app.request(`${origin}${documentPath}`, {
            method: "HEAD",
            headers: { host },
          });
          expect(head.status).toBe(200);
          expect(await head.text()).toBe("");
          expect(head.headers.get("last-modified")).toBeNull();
        }
        const asset = await app.request(
          `${origin}/assets/pdf-preview/viewer.js`,
          { headers: { host, origin: "null" } },
        );
        expect(asset.status).toBe(200);
        expect(asset.headers.get("access-control-allow-origin")).toBe("null");
        expect(
          asset.headers.get("access-control-allow-credentials"),
        ).toBeNull();
        expect(asset.headers.get("cross-origin-resource-policy")).toBe(
          "cross-origin",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts bounded legacy and modern reports without echoing report fields", async () => {
    const { app } = createApp();
    const before = readCspReportDiagnosticCounters().accepted;
    const legacy = await createRequestBody(
      app,
      JSON.stringify({
        "csp-report": {
          "document-uri":
            "https://agent.example.test/private/path?token=secret",
          "blocked-uri": "https://hostile.example.test/payload.js",
          "violated-directive": "script-src-elem",
        },
      }),
      "application/csp-report",
    );
    expect(legacy.status).toBe(204);
    expect(await legacy.text()).toBe("");

    const modern = await createRequestBody(
      app,
      JSON.stringify([
        {
          type: "csp-violation",
          age: 4,
          url: "https://agent.example.test/",
          user_agent: "safe-test-agent",
          body: {
            effectiveDirective: "frame-src",
            blockedURL: "https://hostile.example.test/frame",
          },
        },
      ]),
      "application/reports+json",
    );
    expect(modern.status).toBe(204);
    expect(readCspReportDiagnosticCounters().accepted - before).toBe(2);
  });

  it("rejects malformed content types and payloads without reflecting private fields", async () => {
    const { app } = createApp();
    const malformed = await createRequestBody(
      app,
      JSON.stringify({ "csp-report": "https://private.test/secret" }),
      "application/json",
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain("private.test");

    const unsupported = await createRequestBody(
      app,
      "https://private.test/private-body",
      "text/plain",
    );
    expect(unsupported.status).toBe(415);
    expect(await unsupported.text()).not.toContain("private.test");
  });

  it("enforces the 16 KiB limit while reading an untrusted streamed body", async () => {
    const { app } = createApp();
    const bytes = new TextEncoder().encode(
      `{"csp-report":{"sample":"${"x".repeat(CSP_REPORT_MAX_BODY_BYTES)}"}}`,
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 7));
        controller.enqueue(bytes.subarray(7));
        controller.close();
      },
    });
    const request = new Request(`${agentOrigin}/api/public/csp-report`, {
      method: "POST",
      headers: {
        host: agentHost,
        "content-type": "application/csp-report",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const response = await app.request(request);
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain('"sample"');
    expect(readCspReportDiagnosticCounters().too_large).toBeGreaterThan(0);
  });

  it("uses the shared atomic anonymous bucket and returns a bounded retry delay", async () => {
    const { app } = createApp();
    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitMax: 1 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const body = JSON.stringify({
      "csp-report": { "violated-directive": "img-src" },
    });

    const first = await createRequestBody(app, body, "application/csp-report");
    expect(first.status).toBe(204);
    const limited = await createRequestBody(
      app,
      body,
      "application/csp-report",
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const rows = await db
      .select({
        bucket: schema.requestRateLimitCounterTable.bucket,
        keyHash: schema.requestRateLimitCounterTable.keyHash,
      })
      .from(schema.requestRateLimitCounterTable);
    const row = rows.find((entry) => entry.bucket === "anonymous_csp_report");
    expect(row?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("no-trusted-client-ip");
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
