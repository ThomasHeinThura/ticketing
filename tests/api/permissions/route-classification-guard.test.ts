/**
 * Unit tests for issue #8's runtime-authorization-integration obligation: "a missing or
 * invalid policy cannot silently serve a request."
 *
 * `assertRouteIsClassified` (`apps/api/src/permissions/route-classification-guard.ts`) is
 * exercised through a real, minimal Hono app rather than a hand-built `Context` mock, so
 * `c.req.matchedRoutes` is populated exactly the way it is for a real request. The policy
 * registry is mocked to a small, controlled set of entries -- this test is about the guard's
 * own presence check, not about which of the real ~85 production routes are classified
 * (that is `tests/permissions/route-coverage.test.ts`'s job).
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/policy-registry", () => ({
  policyRegistry: {
    get: (routeKey: string) =>
      routeKey === "GET /classified"
        ? {
            routeKey,
            kind: "public",
            source: "test fixture",
            policy: { public: true, reason: "test fixture" },
          }
        : undefined,
  },
}));

const { assertRouteIsClassified } = await import(
  "../../../apps/api/src/permissions/route-classification-guard"
);

function buildApp() {
  const app = new Hono();
  app.onError((error) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    assertRouteIsClassified(c);
    await next();
  });
  app.get("/classified", (c) => c.text("served"));
  app.get("/unclassified", (c) => c.text("should never be reached"));
  return app;
}

describe("assertRouteIsClassified", () => {
  it("serves a request whose route has a registry entry", async () => {
    const res = await buildApp().request("/classified");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("served");
  });

  it("refuses -- never silently serves -- a request whose route has no registry entry", async () => {
    const res = await buildApp().request("/unclassified");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toBe("should never be reached");
  });
});
