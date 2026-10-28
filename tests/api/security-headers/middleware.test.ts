import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  cspNonceForContext,
  injectCspNonceIntoHtmlResponse,
} from "../../../apps/api/src/security-headers/html-nonce";
import { createSecurityHeadersMiddleware } from "../../../apps/api/src/security-headers/middleware";

function testApp(readCspMode: () => Promise<string>) {
  const app = new Hono();
  const middleware = createSecurityHeadersMiddleware({
    surfaceForContext: (context) =>
      new URL(context.req.url).hostname === "portal.example.test"
        ? "portal"
        : "agent",
    origins: {
      agent: "https://agent.example.test",
      portal: "https://portal.example.test",
      storage: { agent: ["https://files.example.test"], portal: [] },
      telemetry: { agent: [], portal: [] },
    },
    readCspMode,
  });
  app.use("*", middleware);
  app.get("/", async (context) => {
    const response = new Response("<script src='/app.js'></script>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const nonce = cspNonceForContext(context);
    return nonce ? injectCspNonceIntoHtmlResponse(response, nonce) : response;
  });
  app.get("/pdf-preview.html", async (context) => {
    const response = new Response(
      '<script type="module" src="/assets/pdf-preview/viewer-abc123.js"></script>',
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
    const nonce = cspNonceForContext(context);
    return nonce ? injectCspNonceIntoHtmlResponse(response, nonce) : response;
  });
  app.get("/api/probe", (context) => context.json({ ok: true }));
  return app;
}

describe("security headers middleware", () => {
  it("preserves separate cookies while applying response policies", async () => {
    const app = testApp(async () => "report_only");
    app.get("/api/cookies", (context) => {
      context.header("Set-Cookie", "first=one; Path=/", { append: true });
      context.header("Set-Cookie", "second=two; Path=/", { append: true });
      return context.json({ ok: true });
    });
    const response = await app.request(
      "https://agent.example.test/api/cookies",
    );
    expect(response.headers.getSetCookie()).toEqual([
      "first=one; Path=/",
      "second=two; Path=/",
    ]);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("uses unique shell nonces and emits report-only CSP with exact response headers", async () => {
    const readMode = vi.fn(async () => "report_only");
    const app = testApp(readMode);
    const first = await app.request("https://agent.example.test/");
    const second = await app.request("https://agent.example.test/");
    const firstPolicy = first.headers.get(
      "content-security-policy-report-only",
    );
    const secondPolicy = second.headers.get(
      "content-security-policy-report-only",
    );
    const firstNonce = firstPolicy?.match(/'nonce-([^']+)'/)?.[1];
    const secondNonce = secondPolicy?.match(/'nonce-([^']+)'/)?.[1];

    expect(first.status).toBe(200);
    expect(firstPolicy).toContain("default-src 'none'");
    expect(first.headers.has("content-security-policy")).toBe(false);
    expect(first.headers.get("reporting-endpoints")).toBe(
      'csp-endpoint="https://agent.example.test/api/public/csp-report"',
    );
    expect(first.headers.get("strict-transport-security")).toBe(
      "max-age=63072000",
    );
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("x-frame-options")).toBe("DENY");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.text()).toContain(`nonce="${firstNonce}"`);
    expect(secondNonce).not.toBe(firstNonce);
    expect(await second.text()).toContain(`nonce="${secondNonce}"`);
    expect(readMode).toHaveBeenCalledTimes(2);
  });

  it("does not read CSP settings on API responses and uses exact portal origins", async () => {
    const readMode = vi.fn(async () => "report_only");
    const app = testApp(readMode);
    const api = await app.request("https://agent.example.test/api/probe");
    const portal = await app.request("https://portal.example.test/");

    expect(api.status).toBe(200);
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api.headers.has("content-security-policy")).toBe(false);
    expect(readMode).toHaveBeenCalledTimes(1);
    expect(portal.headers.get("content-security-policy-report-only")).toContain(
      "connect-src 'self' wss://portal.example.test",
    );
    expect(
      portal.headers.get("content-security-policy-report-only"),
    ).not.toContain("agent.example.test");
  });

  it("fails closed to enforced CSP when mode lookup fails or is invalid", async () => {
    for (const readMode of [
      async () => {
        throw new Error("settings unavailable");
      },
      async () => "invalid",
    ]) {
      const response = await testApp(readMode).request(
        "https://agent.example.test/",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "default-src 'none'",
      );
      expect(response.headers.has("content-security-policy-report-only")).toBe(
        false,
      );
    }
  });

  it("enforces the isolated PDF child policy regardless of the application CSP mode", async () => {
    const readMode = vi.fn(async () => "report_only");
    const response = await testApp(readMode).request(
      "https://agent.example.test/pdf-preview.html",
    );
    const policy = response.headers.get("content-security-policy");
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];

    expect(response.status).toBe(200);
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain(
      "script-src https://agent.example.test/assets/pdf-preview/",
    );
    expect(policy).not.toContain("unsafe-eval");
    expect(response.headers.has("content-security-policy-report-only")).toBe(
      false,
    );
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe("origin");
    expect(await response.text()).toContain(`nonce="${nonce}"`);
    expect(readMode).not.toHaveBeenCalled();
  });

  it("keeps an existing stricter file CSP intact", async () => {
    const app = new Hono();
    const readMode = vi.fn(async () => "report_only");
    app.use(
      "*",
      createSecurityHeadersMiddleware({
        surfaceForContext: () => "agent",
        origins: {
          agent: "https://agent.example.test",
          portal: "https://portal.example.test",
        },
        readCspMode: readMode,
      }),
    );
    app.get("/api/file", (context) => {
      context.header("Content-Security-Policy", "default-src 'none'; sandbox");
      return context.body("unsafe", 200, {
        "content-type": "text/html",
        "content-disposition": "attachment",
      });
    });

    const response = await app.request("https://agent.example.test/api/file");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.has("content-security-policy-report-only")).toBe(
      false,
    );
    expect(readMode).not.toHaveBeenCalled();
    expect(await response.text()).toBe("unsafe");
  });
});
