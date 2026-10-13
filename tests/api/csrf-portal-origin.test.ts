import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { csrfProtectionMiddleware } from "../../apps/api/src/utils/csrf-protection";

const PORTAL_ORIGIN = "http://portal.localhost:5174";
const AGENT_ORIGIN = "http://localhost:5173";
const PORTAL_COOKIE = "__Host-tdk_portal_session=signed-session";

function probe(appOrigin: "agent" | "portal") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("appOrigin" as never, appOrigin as never);
    c.set("userId" as never, "customer-1" as never);
    c.set(
      "session" as never,
      {
        id: "session-1",
        userId: "customer-1",
        portal: "customer",
      } as never,
    );
    return next();
  });
  app.use("*", csrfProtectionMiddleware());
  app.post("/mutate", (c) => c.json({ ok: true }));
  app.get("/read", (c) => c.json({ ok: true }));
  return app;
}

const post = (app: ReturnType<typeof probe>, headers: Record<string, string>) =>
  app.request("/mutate", {
    method: "POST",
    headers: { cookie: PORTAL_COOKIE, ...headers },
  });

describe("portal cookie-session unsafe requests (no agent CSRF token)", () => {
  it("accepts the exact portal Origin without any X-TaskDesk-CSRF token", async () => {
    const app = probe("portal");
    expect((await post(app, { origin: PORTAL_ORIGIN })).status).toBe(200);
    expect(
      (await post(app, { referer: `${PORTAL_ORIGIN}/catalogue` })).status,
    ).toBe(200);
  });

  it("refuses missing, null, agent and foreign origins with csrf_origin_invalid", async () => {
    const app = probe("portal");
    const denied: Record<string, string>[] = [
      {},
      { origin: "null" },
      { origin: AGENT_ORIGIN },
      { origin: "https://evil.example" },
      { referer: `${AGENT_ORIGIN}/x` },
      { "sec-fetch-site": "same-origin" },
    ];
    for (const headers of denied) {
      const response = await post(app, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(await response.json()).toEqual({ message: "csrf_origin_invalid" });
    }
  });

  it("refuses a portal-session request that arrives on the agent host", async () => {
    const response = await post(probe("agent"), { origin: PORTAL_ORIGIN });
    expect(response.status).toBe(403);
  });

  it("leaves safe methods untouched", async () => {
    const response = await probe("portal").request("/read", {
      headers: { cookie: PORTAL_COOKIE },
    });
    expect(response.status).toBe(200);
  });
});
