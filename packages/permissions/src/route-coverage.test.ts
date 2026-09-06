import { describe, expect, it } from "vitest";
import type { PolicyMap } from "./policy";
import { createPolicyRegistry } from "./registry";
import {
  classifySurface,
  collectMiddleware,
  collectRoutes,
  computeRouteCoverage,
  type HonoLikeApp,
  isMiddlewareEntry,
} from "./route-coverage";

/** `app.use(...)` registers this shape: ALL, a wildcard, and a `(c, next)` handler. */
const middleware = (path: string) => ({
  method: "ALL",
  path,
  handler: (_c: never, _next: never) => undefined,
});

/** A terminal handler takes the context alone. */
const handler = (method: string, path: string) => ({
  method,
  path,
  handler: (_c: never) => undefined,
});

const app = (routes: HonoLikeApp["routes"]): HonoLikeApp => ({ routes });

const registryOf = (policies: PolicyMap) =>
  createPolicyRegistry([{ name: "test", policies }]);

describe("telling middleware from routes", () => {
  it("treats app.use registrations as middleware", () => {
    expect(isMiddlewareEntry(middleware("/*"))).toBe(true);
    expect(isMiddlewareEntry(middleware("/api/*"))).toBe(true);
  });

  it("does NOT treat a catch-all terminal handler as middleware", () => {
    // app.all("/api/*", (c) => …) — a real, reachable route. kaneo's own `api.use("*")`
    // ordering is why this has to fail safe: anything that might answer a request needs a
    // policy.
    expect(isMiddlewareEntry(handler("ALL", "/api/*"))).toBe(false);
  });

  it("does not treat a method-specific wildcard mount as middleware", () => {
    expect(isMiddlewareEntry(handler("GET", "/api/auth/*"))).toBe(false);
  });

  it("does not treat a non-wildcard ALL route as middleware", () => {
    expect(isMiddlewareEntry(handler("ALL", "/api/mcp"))).toBe(false);
  });
});

describe("collectRoutes", () => {
  it("deduplicates a route's middleware chain and counts the registrations", () => {
    const routes = collectRoutes(
      app([
        middleware("/api/*"),
        handler("GET", "/api/task/:id"),
        handler("GET", "/api/task/:id"),
        handler("GET", "/api/task/:id"),
      ]),
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      routeKey: "GET /api/task/{id}",
      registrations: 3,
    });
  });

  it("normalises Hono parameters into the registry's brace syntax", () => {
    const routes = collectRoutes(app([handler("PUT", "/api/label/:id/task")]));
    expect(routes[0].routeKey).toBe("PUT /api/label/{id}/task");
  });

  it("keeps every surface the OpenAPI document cannot see", () => {
    const routes = collectRoutes(
      app([
        handler("POST", "/api/auth/*"),
        handler("GET", "/api/ws/:projectId"),
        handler("GET", "/metrics"),
        handler("GET", "/api/health"),
        handler("GET", "/api/.well-known/oauth-protected-resource/api/mcp"),
        handler("GET", "/api/project/:id"),
        handler("GET", "/favicon.ico"),
      ]),
    );
    expect(routes.map((route) => route.surface).sort()).toEqual([
      "api",
      "auth",
      "health",
      "metrics",
      "root",
      "websocket",
      "well-known",
    ]);
  });

  it("reports middleware separately", () => {
    expect(
      collectMiddleware(app([middleware("/*"), handler("GET", "/x")])),
    ).toEqual(["ALL /*"]);
  });
});

describe("classifySurface", () => {
  it("does not mistake a lookalike path for the auth mount", () => {
    expect(classifySurface("/api/authors/{id}")).toBe("api");
    expect(classifySurface("/api/auth/sign-in")).toBe("auth");
  });
});

describe("computeRouteCoverage", () => {
  const routes = collectRoutes(
    app([
      handler("GET", "/api/project/:id"),
      handler("DELETE", "/api/project/:id"),
    ]),
  );

  it("fails on a route with no policy and no baseline entry", () => {
    const result = computeRouteCoverage(
      routes,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.uncovered.map((route) => route.routeKey)).toEqual([
      "DELETE /api/project/{id}",
    ]);
  });

  it("passes when the uncovered route is a known, listed inheritance", () => {
    const result = computeRouteCoverage(
      routes,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
        },
      }),
      { uncovered: ["DELETE /api/project/{id}"] },
    );
    expect(result.ok).toBe(true);
    expect(result.knownUncovered).toHaveLength(1);
  });

  it("fails when a baseline entry has since been given a policy — the list only shrinks", () => {
    const result = computeRouteCoverage(
      routes,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
        },
        "DELETE /api/project/{id}": {
          capability: "project:delete",
          scope: "project",
        },
      }),
      { uncovered: ["DELETE /api/project/{id}"] },
    );
    expect(result.ok).toBe(false);
    expect(result.baselineNowCovered).toEqual(["DELETE /api/project/{id}"]);
  });

  it("fails when a baseline entry names a route the router no longer has", () => {
    const result = computeRouteCoverage(
      routes,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
        },
        "DELETE /api/project/{id}": {
          capability: "project:delete",
          scope: "project",
        },
      }),
      { uncovered: ["GET /api/public-project/{id}"] },
    );
    expect(result.ok).toBe(false);
    expect(result.baselineStale).toEqual(["GET /api/public-project/{id}"]);
  });

  it("fails on a policy whose route does not exist — a renamed path leaves one behind", () => {
    const result = computeRouteCoverage(
      routes,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
        },
        "DELETE /api/project/{id}": {
          capability: "project:delete",
          scope: "project",
        },
        "GET /api/projects/{id}": {
          capability: "project:read",
          scope: "project",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.orphanedPolicies).toEqual(["GET /api/projects/{id}"]);
  });

  it("counts coverage per surface", () => {
    const result = computeRouteCoverage(
      collectRoutes(
        app([
          handler("GET", "/api/health"),
          handler("GET", "/api/project/:id"),
        ]),
      ),
      registryOf({
        "GET /api/health": { public: true, reason: "liveness probe" },
      }),
      { uncovered: ["GET /api/project/{id}"] },
    );
    expect(result.bySurface.health).toEqual({
      total: 1,
      covered: 1,
      uncovered: 0,
    });
    expect(result.bySurface.api).toEqual({
      total: 1,
      covered: 0,
      uncovered: 1,
    });
  });
});
