/**
 * Route coverage — the machinery that enumerates **Hono's actual router**.
 *
 * Not the OpenAPI document. The OpenAPI document cannot see the inline routes registered
 * directly on the root app, the `/auth/*` mount, the websocket surface or `/metrics`, and
 * `createRoute({ security: [] })` is documentation-only — it edits the document and has zero
 * runtime effect, so the docs and the enforcement can disagree silently. Those surfaces are
 * precisely the ones v1 leaked through.
 *
 * This module takes a **structural** view of a Hono app (`{ routes: [{ method, path, handler }] }`)
 * so `packages/permissions` stays a pure package with no framework dependency.
 */

import { normaliseRoutePath, type RouteKey } from "./policy";
import type { PolicyRegistry } from "./registry";

/** The shape Hono exposes as `app.routes`. Structural — no import of hono here. */
export type HonoRouterEntry = {
  readonly method: string;
  readonly path: string;
  readonly handler: (...args: never[]) => unknown;
};

export type HonoLikeApp = {
  readonly routes: readonly HonoRouterEntry[];
};

/**
 * The surfaces coverage has to account for. Reported so a run proves each was seen, rather
 * than a surface quietly having no rows.
 */
export const ROUTE_SURFACES = [
  "auth",
  "websocket",
  "metrics",
  "health",
  "well-known",
  "api",
  "root",
] as const;

export type RouteSurface = (typeof ROUTE_SURFACES)[number];

export type CollectedRoute = {
  readonly routeKey: RouteKey;
  readonly method: string;
  readonly path: string;
  readonly surface: RouteSurface;
  /** How many registrations Hono holds for this key — a route plus its middleware chain. */
  readonly registrations: number;
};

/**
 * Is this router entry a middleware registration rather than a route?
 *
 * `app.use(...)` registers `method: "ALL"` on a wildcard path with a `(c, next)` handler. All
 * three must hold. The rule is deliberately **fail-safe**: a catch-all terminal handler
 * (`app.all("/api/*", (c) => …)`, arity 1) is *not* middleware and therefore still has to
 * carry a policy — which is exactly the shape of route that hid behind kaneo's `api.use("*")`
 * ordering.
 */
export function isMiddlewareEntry(entry: HonoRouterEntry): boolean {
  return (
    entry.method === "ALL" &&
    entry.path.includes("*") &&
    entry.handler.length >= 2
  );
}

export function classifySurface(path: string): RouteSurface {
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return "auth";
  if (path === "/auth" || path.startsWith("/auth/")) return "auth";
  if (path === "/api/ws" || path.startsWith("/api/ws/")) return "websocket";
  if (path === "/ws" || path.startsWith("/ws/")) return "websocket";
  if (path === "/metrics" || path.startsWith("/metrics/")) return "metrics";
  if (path === "/api/health" || path === "/health") return "health";
  if (path.includes("/.well-known/")) return "well-known";
  if (path === "/api" || path.startsWith("/api/")) return "api";
  return "root";
}

/**
 * Every routable entry in the router, deduplicated by `METHOD path`.
 *
 * Hono pushes one entry per handler in a chain, so a route with three middlewares appears four
 * times; `registrations` keeps that count for diagnostics.
 */
export function collectRoutes(app: HonoLikeApp): CollectedRoute[] {
  const byKey = new Map<RouteKey, { route: CollectedRoute; count: number }>();

  for (const entry of app.routes) {
    if (isMiddlewareEntry(entry)) continue;

    const path = normaliseRoutePath(entry.path);
    const method = entry.method.toUpperCase();
    const routeKey = `${method} ${path}`;
    const existing = byKey.get(routeKey);
    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }
    byKey.set(routeKey, {
      route: {
        routeKey,
        method,
        path,
        surface: classifySurface(path),
        registrations: 1,
      },
      count: 1,
    });
  }

  return [...byKey.values()]
    .map(({ route, count }) => ({ ...route, registrations: count }))
    .sort((a, b) => a.routeKey.localeCompare(b.routeKey));
}

/** Every middleware registration, for the report. */
export function collectMiddleware(app: HonoLikeApp): RouteKey[] {
  const keys = new Set<RouteKey>();
  for (const entry of app.routes) {
    if (!isMiddlewareEntry(entry)) continue;
    keys.add(`${entry.method.toUpperCase()} ${normaliseRoutePath(entry.path)}`);
  }
  return [...keys].sort();
}

export type CoverageBaseline = {
  /**
   * Inherited routes that have no policy yet. **A temporary, monotonically shrinking list,
   * owned by #8** (the router retrofit), not a permanent allowlist.
   */
  readonly uncovered: readonly string[];
};

export type CoverageResult = {
  readonly covered: readonly CollectedRoute[];
  /** Routes with no policy and no baseline entry. Any row here fails the build. */
  readonly uncovered: readonly CollectedRoute[];
  /** Routes with no policy that the baseline already knows about. */
  readonly knownUncovered: readonly CollectedRoute[];
  /** Baseline entries that now have a policy — delete the line. */
  readonly baselineNowCovered: readonly string[];
  /** Baseline entries that name a route the router no longer has — delete the line. */
  readonly baselineStale: readonly string[];
  /** Policies for routes the router does not have. A renamed path leaves one of these behind. */
  readonly orphanedPolicies: readonly string[];
  readonly bySurface: Readonly<
    Record<RouteSurface, { total: number; covered: number; uncovered: number }>
  >;
  readonly ok: boolean;
};

/**
 * Compare the router against the registry.
 *
 * Four ways to fail, and all four are omissions rather than mistakes — which is the entire
 * point: v1's eleven authorization holes were every one of them an omission.
 */
export function computeRouteCoverage(
  routes: readonly CollectedRoute[],
  registry: PolicyRegistry,
  baseline: CoverageBaseline = { uncovered: [] },
): CoverageResult {
  const baselineSet = new Set(baseline.uncovered);
  const routeKeys = new Set(routes.map((route) => route.routeKey));

  const covered: CollectedRoute[] = [];
  const uncovered: CollectedRoute[] = [];
  const knownUncovered: CollectedRoute[] = [];
  const baselineNowCovered: string[] = [];

  for (const route of routes) {
    if (registry.has(route.routeKey)) {
      covered.push(route);
      if (baselineSet.has(route.routeKey)) {
        baselineNowCovered.push(route.routeKey);
      }
      continue;
    }
    if (baselineSet.has(route.routeKey)) {
      knownUncovered.push(route);
      continue;
    }
    uncovered.push(route);
  }

  const baselineStale = [...baselineSet]
    .filter((key) => !routeKeys.has(key))
    .sort();

  const orphanedPolicies = registry.routeKeys
    .filter((key) => !routeKeys.has(key))
    .sort();

  const bySurface = Object.fromEntries(
    ROUTE_SURFACES.map((surface) => [
      surface,
      {
        total: routes.filter((route) => route.surface === surface).length,
        covered: covered.filter((route) => route.surface === surface).length,
        uncovered: [...uncovered, ...knownUncovered].filter(
          (route) => route.surface === surface,
        ).length,
      },
    ]),
  ) as CoverageResult["bySurface"];

  return {
    covered,
    uncovered,
    knownUncovered,
    baselineNowCovered,
    baselineStale,
    orphanedPolicies,
    bySurface,
    ok:
      uncovered.length === 0 &&
      baselineNowCovered.length === 0 &&
      baselineStale.length === 0 &&
      orphanedPolicies.length === 0,
  };
}

/** A report a human can act on without opening the code. */
export function formatCoverageReport(result: CoverageResult): string {
  const lines: string[] = [];
  lines.push(
    `routes: ${result.covered.length + result.uncovered.length + result.knownUncovered.length} · with a policy: ${result.covered.length} · awaiting #8: ${result.knownUncovered.length} · undeclared: ${result.uncovered.length}`,
  );
  for (const surface of ROUTE_SURFACES) {
    const row = result.bySurface[surface];
    if (row.total === 0) continue;
    lines.push(`  ${surface.padEnd(11)} ${row.covered}/${row.total} covered`);
  }
  if (result.uncovered.length > 0) {
    lines.push("", "Routes with no policy of any of the five kinds:");
    for (const route of result.uncovered) lines.push(`  ${route.routeKey}`);
  }
  if (result.baselineNowCovered.length > 0) {
    lines.push(
      "",
      "Baseline entries that now have a policy — delete these lines:",
    );
    for (const key of result.baselineNowCovered) lines.push(`  ${key}`);
  }
  if (result.baselineStale.length > 0) {
    lines.push("", "Baseline entries naming routes the router no longer has:");
    for (const key of result.baselineStale) lines.push(`  ${key}`);
  }
  if (result.orphanedPolicies.length > 0) {
    lines.push("", "Policies whose route does not exist:");
    for (const key of result.orphanedPolicies) lines.push(`  ${key}`);
  }
  return lines.join("\n");
}
