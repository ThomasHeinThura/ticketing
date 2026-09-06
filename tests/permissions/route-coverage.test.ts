import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type CoverageBaseline,
  collectRoutes,
  computeRouteCoverage,
  formatCoverageReport,
  ROUTE_SURFACES,
} from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadApiApp,
  loadPolicyRegistry,
  loadRouterMiddleware,
  loadRouterRoutes,
} from "./api-app";

/**
 * Route coverage — the anti-v1 control.
 *
 * A route with no declared policy fails the build. The enumeration is **Hono's actual
 * router**, never the OpenAPI document: the document cannot see the routes registered inline
 * in `index.ts`, the `/auth/*` mount, the websocket upgrades or `/metrics`, and
 * `createRoute({ security: [] })` edits the document with zero runtime effect — so documentation
 * and enforcement can disagree silently. Position is untrusted too: kaneo's `api.use("*")`
 * gates only what is registered below it, and sixteen inherited routes sit above it.
 */

const BASELINE_PATH = fileURLToPath(
  new URL("./inherited-uncovered.json", import.meta.url),
);

const baseline = JSON.parse(
  readFileSync(BASELINE_PATH, "utf8"),
) as CoverageBaseline & { readonly $comment?: string };

describe("route coverage", () => {
  let result: ReturnType<typeof computeRouteCoverage>;
  let routeCount = 0;

  beforeAll(async () => {
    const [routes, registry] = await Promise.all([
      loadRouterRoutes(),
      loadPolicyRegistry(),
    ]);
    routeCount = routes.length;
    result = computeRouteCoverage(routes, registry, baseline);
  }, 120_000);

  it("finds a router to enumerate at all", () => {
    // A silent zero here would make every other assertion in this file vacuous.
    expect(routeCount).toBeGreaterThan(0);
  });

  it("has a policy for every route, except the inherited ones #8 has yet to classify", () => {
    expect(result.uncovered.map((route) => route.routeKey)).toEqual([]);
  });

  it("has no policy for a route that does not exist", () => {
    // A renamed path leaves its old policy behind, and the route it now names has none.
    expect(result.orphanedPolicies).toEqual([]);
  });

  it("keeps the inherited-uncovered list shrinking, never growing", () => {
    // A baseline entry that now has a policy, or that names a route the router no longer has,
    // must be deleted in the same change. Otherwise the list rots into a permanent allowlist.
    expect(result.baselineNowCovered).toEqual([]);
    expect(result.baselineStale).toEqual([]);
  });

  it("accounts for every surface the router exposes", () => {
    for (const surface of ROUTE_SURFACES) {
      const row = result.bySurface[surface];
      expect(row.covered + row.uncovered, surface).toBe(row.total);
    }
    const seen = ROUTE_SURFACES.filter(
      (surface) => result.bySurface[surface].total > 0,
    );
    // The surfaces the OpenAPI document cannot see are the ones v1 leaked through, so their
    // presence in the enumeration is asserted rather than assumed.
    expect(seen).toContain("auth");
    expect(seen).toContain("websocket");
    expect(seen).toContain("health");
    expect(seen).toContain("api");
  });

  it("covers the /auth/* mount, the websocket surface and the health probe", async () => {
    const registry = await loadPolicyRegistry();
    for (const routeKey of [
      "GET /api/auth/*",
      "POST /api/auth/*",
      "GET /api/ws/user",
      "GET /api/health",
    ]) {
      expect(registry.has(routeKey), routeKey).toBe(true);
    }
  });

  it("counts middleware as middleware, not as routes", async () => {
    const middleware = await loadRouterMiddleware();
    // kaneo registers `app.use("*")` for CORS and compression and `api.use("*")` for the
    // authentication guard. They are chain entries, not endpoints.
    expect(middleware.length).toBeGreaterThan(0);
    for (const entry of middleware) {
      expect(entry.startsWith("ALL "), entry).toBe(true);
    }
  });

  it("FAILS when a new route arrives without a policy", async () => {
    // Throttle 1's fifth condition, proven rather than asserted: this is the real router with
    // one extra route bolted on, exactly as adding an endpoint would do. If this ever passes,
    // the gate is not a gate.
    const app = await loadApiApp();
    const withNewRoute = {
      routes: [
        ...app.routes,
        {
          method: "POST",
          path: "/api/work-items/:id/grant-everything",
          handler: (_c: never) => undefined,
        },
      ],
    };
    const registry = await loadPolicyRegistry();
    const withNewRouteResult = computeRouteCoverage(
      collectRoutes(withNewRoute),
      registry,
      baseline,
    );
    expect(withNewRouteResult.ok).toBe(false);
    expect(withNewRouteResult.uncovered.map((route) => route.routeKey)).toEqual(
      ["POST /api/work-items/{id}/grant-everything"],
    );
  }, 120_000);

  it("prints a report a human can act on", () => {
    const report = formatCoverageReport(result);
    expect(report).toMatch(/routes: \d+/);
    if (!result.ok) console.error(report);
  });
});
