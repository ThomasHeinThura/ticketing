import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type CoverageBaseline,
  collectRoutes,
  computeRouteCoverage,
  createPolicyRegistry,
  formatCoverageReport,
  type HonoLikeApp,
  ROUTE_SURFACES,
} from "@taskdesk/permissions";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadApiApp,
  loadPolicyRegistry,
  loadRouterMiddleware,
  loadRouterRoutes,
} from "./api-app";
import {
  diffBaselineEntries,
  REPO_ROOT,
  readJsonAtMergeBase,
} from "./git-baseline";

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

    // Neither of the checks above catches a PR that adds a new, unpolicied route AND appends
    // that route's key to this file in the same diff: from the current router's point of
    // view, the new route simply looks like "a known, already-inherited omission", and the
    // two assertions above are computed entirely against the *current* file — comparing it
    // to itself. The only thing that can catch a widened baseline is comparing it to what it
    // held before this change: the merge base with main. See `git-baseline.ts` for exactly
    // how "before this change" is defined, including on `main` itself and mid-bootstrap.
    const previous = readJsonAtMergeBase(
      REPO_ROOT,
      "tests/permissions/inherited-uncovered.json",
    ) as (CoverageBaseline & { readonly $comment?: unknown }) | null;
    if (previous === null) {
      // Bootstrap: this file did not exist yet at the merge base with main — this is the
      // branch introducing it (#7). There is nothing to have grown from yet; every PR whose
      // merge base is the commit this one becomes on `main` gets a live comparison instead.
      return;
    }
    const drift = diffBaselineEntries(previous.uncovered, baseline.uncovered);
    expect(
      drift.added,
      "entries appended to inherited-uncovered.json since the merge base with main",
    ).toEqual([]);
  });

  it("2: STILL FAILS when a new route's key is appended to the baseline in the same diff", async () => {
    // The exact proven consequence: add a route with no policy, hide it by appending its key
    // to inherited-uncovered.json, and (before this fix) the gate went green because nothing
    // compared the file to its own history. Using the real, committed baseline as "previous"
    // and that same array plus one extra key as "current" proves the detection is real,
    // independent of whether this repository's own git history happens to have a usable
    // merge base for the file right now (see the `git-baseline.test.ts` suite for the git
    // plumbing itself, proven against both this real repository and scratch ones).
    const augmented = {
      ...baseline,
      uncovered: [
        ...baseline.uncovered,
        "POST /api/work-items/{id}/grant-everything",
      ],
    };
    // Old behaviour: appending the key to the baseline makes the new route "known, already
    // inherited" from the router's point of view, and the gate would go green.
    const app = await loadApiApp();
    const withNewRoute: HonoLikeApp = {
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
    const hiddenResult = computeRouteCoverage(
      collectRoutes(withNewRoute),
      registry,
      augmented,
    );
    expect(hiddenResult.ok).toBe(true); // confirms the old hole really is a hole

    // The growth check this fix adds catches exactly this: the augmented file added a key
    // that the previously-committed baseline never had.
    const drift = diffBaselineEntries(baseline.uncovered, augmented.uncovered);
    expect(drift.added).toEqual(["POST /api/work-items/{id}/grant-everything"]);
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
    // authentication guard. They are chain entries, not endpoints — exactly two distinct
    // `METHOD path` keys (cors and compress share "ALL /*"), never inferred from arity.
    expect(middleware).toEqual(["ALL /*", "ALL /api/*"]);
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

/**
 * Opaque wildcard surfaces — the defect this file exists to close.
 *
 * `isMiddlewareEntry` used to exclude any `method: "ALL"`, wildcard-path entry whose handler
 * took two parameters. Hono's own `app.mount(path, handler)` compiles to exactly that shape,
 * so every endpoint of a mounted application was invisible to the gate — real, answerable
 * requests, and zero rows in `collectRoutes`. These three tests build a **real** Hono app
 * (never a hand-built fixture whose arity was chosen to make the assertion pass) to prove: the
 * mount genuinely serves traffic, its route does not vanish, an undeclared one fails the gate,
 * and a declared one — given its own coverage contract, the same mechanism `/api/auth/*`
 * already uses — passes.
 */
describe("opaque mounts do not vanish from coverage", () => {
  function buildAppWithMount() {
    const mounted = new Hono();
    mounted.get("/widgets", (c) => c.json({ widgets: ["a", "b"] }));

    const root = new Hono();
    root.get("/health", (c) => c.json({ status: "ok" }));
    root.mount("/legacy", mounted.fetch);

    return root;
  }

  it("1: a mounted surface answers real requests, and the enumerator does not silently return zero for it", async () => {
    const root = buildAppWithMount();

    // The mount is not a fixture — it genuinely serves the request.
    const response = await root.request("/legacy/widgets");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ widgets: ["a", "b"] });

    // Before this fix, `app.mount`'s registration — method ALL, path "/legacy/*", a two-
    // argument handler — was indistinguishable from real middleware by shape alone, and
    // `collectRoutes` silently returned zero rows for it.
    const routes = collectRoutes(root as unknown as HonoLikeApp);
    expect(routes.map((route) => route.routeKey)).toContain("ALL /legacy/*");
  });

  it("2: an UNDECLARED mounted/opaque wildcard surface FAILS the gate", async () => {
    const root = buildAppWithMount();
    const routes = collectRoutes(root as unknown as HonoLikeApp);
    const registry = createPolicyRegistry([
      {
        name: "test",
        policies: {
          "GET /health": { public: true, reason: "liveness probe" },
        },
      },
    ]);

    const result = computeRouteCoverage(routes, registry);
    expect(result.ok).toBe(false);
    // Unclassified, not uncovered — and the distinction is the control. An entry in
    // `uncovered` can be absorbed by a line in inherited-uncovered.json; this one cannot be,
    // and it cannot be cleared by an ordinary capability policy either. Only a `delegated`
    // policy, whose mandatory reason says what authenticates the surface behind the mount.
    expect(result.unclassified.map((route) => route.routeKey)).toEqual([
      "ALL /legacy/*",
    ]);
    expect(result.uncovered).toEqual([]);
  });

  it("3: a DECLARED delegated/opaque mount passes", async () => {
    const root = buildAppWithMount();
    const routes = collectRoutes(root as unknown as HonoLikeApp);
    const registry = createPolicyRegistry([
      {
        name: "test",
        policies: {
          "GET /health": { public: true, reason: "liveness probe" },
          // The same mechanism `/api/auth/*` already uses in the real registry: a delegated
          // policy allowlists the mount and carries its own reason — its own coverage
          // contract — rather than the gate inferring anything from the handler's shape.
          "ALL /legacy/*": {
            delegated: "metrics",
            reason:
              "test: a declared legacy mount, enumerated by its own separate contract",
          },
        },
      },
    ]);

    const result = computeRouteCoverage(routes, registry);
    expect(result.ok).toBe(true);
  });
});
