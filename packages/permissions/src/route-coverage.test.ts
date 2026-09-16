import { describe, expect, it } from "vitest";
import type { PolicyMap } from "./policy";
import { createPolicyRegistry } from "./registry";
import {
  AUTH_GUARD_KEY,
  authGuardRegistrationIndex,
  classifySurface,
  collectMiddleware,
  collectRoutes,
  computeRouteCoverage,
  DECLARED_ROUTER_MIDDLEWARE,
  formatCoverageReport,
  type HonoLikeApp,
  type HonoRouterEntry,
  isMiddlewareEntry,
} from "./route-coverage";

/**
 * A router entry. `arity` is deliberately a free parameter here, not something chosen to make
 * a particular assertion pass — the whole point of this suite is that `isMiddlewareEntry` no
 * longer looks at it at all.
 */
const entry = (
  method: string,
  path: string,
  arity: 0 | 1 | 2 = 1,
): HonoRouterEntry => ({
  method,
  path,
  handler: (arity === 2
    ? (_c: never, _next: never) => undefined
    : arity === 1
      ? (_c: never) => undefined
      : () => undefined) as HonoRouterEntry["handler"],
});

const app = (routes: HonoLikeApp["routes"]): HonoLikeApp => ({ routes });

const registryOf = (policies: PolicyMap) =>
  createPolicyRegistry([{ name: "test", policies }]);

/** The same counting `collectRoutes`/`collectMiddleware` do internally, built for test setup. */
const countsOf = (routes: HonoLikeApp["routes"]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const r of routes) {
    if (r.method.toUpperCase() !== "ALL" || !r.path.includes("*")) continue;
    const key = `${r.method.toUpperCase()} ${r.path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

describe("telling middleware from routes", () => {
  it("treats the declared cors+compress registrations as middleware, whatever their arity", () => {
    // "ALL /*" is declared with registrations: 2 — cors and compress, in either order, any
    // arity. Arity is not the signal; the declared key + count is.
    const routes = [entry("ALL", "/*", 2), entry("ALL", "/*", 0)];
    const counts = countsOf(routes);
    expect(isMiddlewareEntry(routes[0], counts)).toBe(true);
    expect(isMiddlewareEntry(routes[1], counts)).toBe(true);
  });

  it("treats the declared auth-guard registration as middleware", () => {
    const routes = [entry("ALL", "/api/*", 2)];
    const counts = countsOf(routes);
    expect(isMiddlewareEntry(routes[0], counts)).toBe(true);
  });

  it("never infers middleware from arity alone — an undeclared ALL+wildcard entry stays a route", () => {
    // This is exactly the shape Hono's `app.mount(path, handler)` compiles to (method ALL, a
    // wildcarded path, a two-argument handler that itself calls `next()`), and exactly the
    // shape of a terminal `(c, _next) => …` handler that never calls `next`. Neither key is on
    // DECLARED_ROUTER_MIDDLEWARE, so arity never gets a vote: both stay routes.
    const mount = entry("ALL", "/legacy/*", 2);
    const neverCallsNext = entry("ALL", "/other/*", 2);
    const counts = countsOf([mount, neverCallsNext]);
    expect(isMiddlewareEntry(mount, counts)).toBe(false);
    expect(isMiddlewareEntry(neverCallsNext, counts)).toBe(false);
  });

  it("does not treat a method-specific wildcard mount as middleware", () => {
    expect(isMiddlewareEntry(entry("GET", "/api/auth/*", 1), new Map())).toBe(
      false,
    );
  });

  it("does not treat a non-wildcard ALL route as middleware", () => {
    expect(isMiddlewareEntry(entry("ALL", "/api/mcp", 2), new Map())).toBe(
      false,
    );
  });

  it("voids a declared key's exemption when an extra registration crowds it", () => {
    // A third registration at "/*" (declared count: 2) is what an accidental extra `app.use`
    // — or a mount colliding with the same path — would produce. Every entry sharing the key
    // stops being excluded; none of the three gets to keep the exemption silently.
    const routes = [
      entry("ALL", "/*", 2),
      entry("ALL", "/*", 2),
      entry("ALL", "/*", 2),
    ];
    const counts = countsOf(routes);
    for (const r of routes) expect(isMiddlewareEntry(r, counts)).toBe(false);
  });

  it("voids a declared key's exemption when a registration goes missing", () => {
    const routes = [entry("ALL", "/*", 2)]; // declared count is 2; only 1 is present
    const counts = countsOf(routes);
    expect(isMiddlewareEntry(routes[0], counts)).toBe(false);
  });

  it("DECLARED_ROUTER_MIDDLEWARE is the exhaustive, hand-reviewed list", () => {
    expect(DECLARED_ROUTER_MIDDLEWARE.map((d) => d.key).sort()).toEqual([
      "ALL /*",
      "ALL /api/*",
    ]);
    for (const declared of DECLARED_ROUTER_MIDDLEWARE) {
      expect(declared.note.length).toBeGreaterThan(0);
    }
  });
});

describe("collectRoutes", () => {
  it("deduplicates a route's middleware chain and counts the registrations", () => {
    const routes = collectRoutes(
      app([
        entry("ALL", "/api/*", 2),
        entry("GET", "/api/task/:id"),
        entry("GET", "/api/task/:id"),
        entry("GET", "/api/task/:id"),
      ]),
    );
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      routeKey: "GET /api/task/{id}",
      registrations: 3,
    });
  });

  it("normalises Hono parameters into the registry's brace syntax", () => {
    const routes = collectRoutes(app([entry("PUT", "/api/label/:id/task")]));
    expect(routes[0].routeKey).toBe("PUT /api/label/{id}/task");
  });

  it("keeps every surface the OpenAPI document cannot see", () => {
    const routes = collectRoutes(
      app([
        entry("POST", "/api/auth/*"),
        entry("GET", "/api/ws/:projectId"),
        entry("GET", "/metrics"),
        entry("GET", "/api/health"),
        entry("GET", "/api/.well-known/oauth-protected-resource/api/mcp"),
        entry("GET", "/api/project/:id"),
        entry("GET", "/favicon.ico"),
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

  it("does not silently drop an undeclared opaque wildcard surface — it becomes a route", () => {
    // The regression this whole redesign exists for: previously, method ALL + wildcard path +
    // arity >= 2 was enough to vanish an entry from coverage, which is exactly the shape of an
    // `app.mount(...)`-compiled registration. It must now surface as an ordinary route.
    const routes = collectRoutes(app([entry("ALL", "/legacy/*", 2)]));
    expect(routes.map((r) => r.routeKey)).toEqual(["ALL /legacy/*"]);
  });

  it("reports middleware separately", () => {
    expect(
      collectMiddleware(
        app([entry("ALL", "/*", 2), entry("ALL", "/*", 2), entry("GET", "/x")]),
      ),
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
      entry("GET", "/api/project/:id"),
      entry("DELETE", "/api/project/:id"),
    ]),
  );

  it("fails on a route with no policy and no baseline entry", () => {
    const result = computeRouteCoverage(
      routes,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
          reach: "required",
          scopeSource: "row",
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
          reach: "required",
          scopeSource: "row",
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
          reach: "required",
          scopeSource: "row",
        },
        "DELETE /api/project/{id}": {
          capability: "project:delete",
          scope: "project",
          reach: "required",
          scopeSource: "row",
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
          reach: "required",
          scopeSource: "row",
        },
        "DELETE /api/project/{id}": {
          capability: "project:delete",
          scope: "project",
          reach: "required",
          scopeSource: "row",
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
          reach: "required",
          scopeSource: "row",
        },
        "DELETE /api/project/{id}": {
          capability: "project:delete",
          scope: "project",
          reach: "required",
          scopeSource: "row",
        },
        "GET /api/projects/{id}": {
          capability: "project:read",
          scope: "project",
          reach: "required",
          scopeSource: "row",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.orphanedPolicies).toEqual(["GET /api/projects/{id}"]);
  });

  it("counts coverage per surface", () => {
    const result = computeRouteCoverage(
      collectRoutes(
        app([entry("GET", "/api/health"), entry("GET", "/api/project/:id")]),
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

  it("fails on an undeclared opaque mount just like any other uncovered route", () => {
    // The end-to-end proof of the fix: a mount-shaped entry that used to vanish from coverage
    // now has to have a policy, and fails the same way an ordinary undeclared route would.
    const withMount = collectRoutes(
      app([entry("GET", "/api/project/:id"), entry("ALL", "/legacy/*", 2)]),
    );
    const result = computeRouteCoverage(
      withMount,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
          reach: "required",
          scopeSource: "row",
        },
      }),
    );
    expect(result.ok).toBe(false);
    // Unclassified rather than uncovered, and the distinction is the control: an entry in
    // `uncovered` can be absorbed by a line in inherited-uncovered.json, and this must not be.
    expect(result.unclassified.map((r) => r.routeKey)).toEqual([
      "ALL /legacy/*",
    ]);
    expect(result.uncovered).toEqual([]);
  });

  it("passes an opaque mount once it is declared in the registry with its own coverage contract", () => {
    const withMount = collectRoutes(
      app([entry("GET", "/api/project/:id"), entry("ALL", "/legacy/*", 2)]),
    );
    const result = computeRouteCoverage(
      withMount,
      registryOf({
        "GET /api/project/{id}": {
          capability: "project:read",
          scope: "project",
          reach: "required",
          scopeSource: "row",
        },
        "ALL /legacy/*": {
          delegated: "metrics",
          reason:
            "test fixture standing in for a declared, delegated legacy mount",
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("an undeclared wildcard surface is unclassified, not coverable", () => {
  // Exactly the shape Hono's app.mount() compiles to.
  const opaqueMount = {
    method: "ALL",
    path: "/api/legacy/*",
    handler: async (_c: never, _next: never) => undefined,
  };
  const health = {
    method: "GET",
    path: "/api/health",
    handler: (_c: never) => undefined,
  };
  const app = { routes: [opaqueMount, health] } as never;

  const healthOnly = createPolicyRegistry([
    {
      name: "t",
      policies: {
        "GET /api/health": { public: true, reason: "container liveness probe" },
      },
    },
  ]);

  it("a policy does NOT clear it — the trap this branch exists to close", () => {
    // One line would otherwise turn the gate green while an entire mounted
    // application is nominally guarded by a single capability check that none of
    // its inner routes ever runs. That is an invisible surface repainted as a
    // covered one, which is harder to spot than the original defect.
    const registry = createPolicyRegistry([
      {
        name: "t",
        policies: {
          "ALL /api/legacy/*": {
            capability: "project:read",
            scope: "project",
            reach: "required",
            scopeSource: "row",
          },
          "GET /api/health": {
            public: true,
            reason: "container liveness probe",
          },
        },
      },
    ]);
    const result = computeRouteCoverage(collectRoutes(app), registry);

    expect(result.ok).toBe(false);
    expect(result.unclassified.map((r) => r.routeKey)).toEqual([
      "ALL /api/legacy/*",
    ]);
    expect(result.covered.map((r) => r.routeKey)).not.toContain(
      "ALL /api/legacy/*",
    );
  });

  it("a baseline entry does NOT clear it either — the same trap, shorter diff", () => {
    const result = computeRouteCoverage(collectRoutes(app), healthOnly, {
      uncovered: ["ALL /api/legacy/*"],
    });

    expect(result.ok).toBe(false);
    expect(result.unclassified.map((r) => r.routeKey)).toEqual([
      "ALL /api/legacy/*",
    ]);
    // It must not be laundered into the "already known about" bucket.
    expect(result.knownUncovered.map((r) => r.routeKey)).not.toContain(
      "ALL /api/legacy/*",
    );
  });

  it("the report says where to look rather than only that it failed", () => {
    const result = computeRouteCoverage(collectRoutes(app), healthOnly);
    const report = formatCoverageReport(result);

    expect(report).toContain("UNCLASSIFIED WILDCARD SURFACES");
    expect(report).toContain("ALL /api/legacy/*");
    expect(report).toContain("a `delegated` policy");
  });

  it("a router with no wildcard surfaces is unaffected", () => {
    const plain = { routes: [health] } as never;
    const result = computeRouteCoverage(collectRoutes(plain), healthOnly);

    expect(result.unclassified).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

/**
 * H2 (docs/07-planning/security-reviews/21-policy-registry.md, lines 137-166): "`CollectedRoute`
 * carries no registration index... a route registered above the auth guard is indistinguishable
 * from one below it... when #8 classifies `GET /api/asset/{id}` as `{ capability, scope }` — the
 * obvious verdict — the gate turns green with zero runtime change and the route stays anonymous."
 *
 * `guard` below stands in for `api.use("*", <Sentry isolation scope + authenticateApiRequest
 * guard>)` — same shape Hono actually records for it (method ALL, wildcard path, a
 * two-argument handler), same declared key (`AUTH_GUARD_KEY`, "ALL /api/*"), and exactly one
 * registration, matching `DECLARED_ROUTER_MIDDLEWARE`'s declared count — so it is genuinely
 * classified as the guard by `authGuardRegistrationIndex`, not merely shaped like one.
 */
describe("H2 — a route registered above the auth guard fails the gate", () => {
  const guard = entry("ALL", "/api/*", 2);

  function appAbove(...aboveGuard: HonoRouterEntry[]): HonoLikeApp {
    return app([...aboveGuard, guard]);
  }

  function appBelow(...belowGuard: HonoRouterEntry[]): HonoLikeApp {
    return app([guard, ...belowGuard]);
  }

  it("without an auth-guard index, the hole H2 found is still exactly as open as it always was", () => {
    // This is computeRouteCoverage exactly as every caller invoked it before this fix — no
    // 4th argument. A route above the guard with an ordinary capability policy passes clean,
    // which is H2's claim proven rather than asserted: "the gate turns green with zero runtime
    // change and the route stays anonymous."
    const routes = collectRoutes(appAbove(entry("GET", "/api/asset/:id")));
    const registry = registryOf({
      "GET /api/asset/{id}": {
        capability: "project:read",
        scope: "project",
        reach: "required",
        scopeSource: "row",
      },
    });
    const result = computeRouteCoverage(routes, registry);
    expect(result.ok).toBe(true);
    expect(result.authGuardOrderingViolations).toEqual([]);
  });

  it("passing the guard's own registration index turns the same scenario red", () => {
    const realApp = appAbove(entry("GET", "/api/asset/:id"));
    const routes = collectRoutes(realApp);
    const registry = registryOf({
      "GET /api/asset/{id}": {
        capability: "project:read",
        scope: "project",
        reach: "required",
        scopeSource: "row",
      },
    });

    const authGuardIndex = authGuardRegistrationIndex(realApp);
    expect(authGuardIndex).toEqual(expect.any(Number));

    const result = computeRouteCoverage(
      routes,
      registry,
      undefined,
      authGuardIndex,
    );
    expect(result.ok).toBe(false);
    expect(
      result.authGuardOrderingViolations.map((route) => route.routeKey),
    ).toEqual(["GET /api/asset/{id}"]);
    // Not double-counted as coverage it does not actually have.
    expect(result.covered.map((route) => route.routeKey)).not.toContain(
      "GET /api/asset/{id}",
    );
  });

  it("the identical route BELOW the guard is unaffected", () => {
    const realApp = appBelow(entry("GET", "/api/asset/:id"));
    const routes = collectRoutes(realApp);
    const registry = registryOf({
      "GET /api/asset/{id}": {
        capability: "project:read",
        scope: "project",
        reach: "required",
        scopeSource: "row",
      },
    });

    const result = computeRouteCoverage(
      routes,
      registry,
      undefined,
      authGuardRegistrationIndex(realApp),
    );
    expect(result.ok).toBe(true);
    expect(result.authGuardOrderingViolations).toEqual([]);
  });

  it("self and portal policies above the guard trip the check too, not only capability", () => {
    // The finding's own illustrative example was a capability route, but `self` and `portal`
    // read an identity the guard resolves exactly the same way — nothing about the failure is
    // specific to `capability`.
    const realApp = appAbove(
      entry("GET", "/api/me/avatar"),
      entry("GET", "/api/portal/requests"),
    );
    const routes = collectRoutes(realApp);
    const registry = registryOf({
      "GET /api/me/avatar": {
        authenticated: true,
        self: true,
        personParam: { exempt: "no_person_parameter", reason: "test" },
      },
      "GET /api/portal/requests": {
        portal: "customer",
        predicate: "own_request",
      },
    });

    const result = computeRouteCoverage(
      routes,
      registry,
      undefined,
      authGuardRegistrationIndex(realApp),
    );
    expect(result.ok).toBe(false);
    expect(
      result.authGuardOrderingViolations.map((route) => route.routeKey).sort(),
    ).toEqual(["GET /api/me/avatar", "GET /api/portal/requests"]);
  });

  it("public and delegated policies above the guard are legitimate and never trip the check", () => {
    // Matches the real registry's own shape: GET /api/health (public) and the well-known
    // pattern for a declared mount (delegated) both sit above the real guard today, and H2
    // says exactly that is fine — "every classified one is public or delegated today".
    const realApp = appAbove(
      entry("GET", "/api/health"),
      entry("GET", "/api/legacy-widget"),
    );
    const routes = collectRoutes(realApp);
    const registry = registryOf({
      "GET /api/health": { public: true, reason: "liveness probe" },
      "GET /api/legacy-widget": {
        delegated: "metrics",
        reason: "test: a non-wildcard delegated route above the guard",
      },
    });

    const result = computeRouteCoverage(
      routes,
      registry,
      undefined,
      authGuardRegistrationIndex(realApp),
    );
    expect(result.ok).toBe(true);
    expect(result.authGuardOrderingViolations).toEqual([]);
  });

  it("authGuardRegistrationIndex returns undefined when the app has no declared guard", () => {
    const noGuard = app([entry("GET", "/api/health")]);
    expect(authGuardRegistrationIndex(noGuard)).toBeUndefined();
  });

  it("AUTH_GUARD_KEY names the exact key DECLARED_ROUTER_MIDDLEWARE records the guard under", () => {
    expect(
      DECLARED_ROUTER_MIDDLEWARE.some((d) => d.key === AUTH_GUARD_KEY),
    ).toBe(true);
  });
});
