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

import { isDelegatedPolicy, normaliseRoutePath, type RouteKey } from "./policy";
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
 * A hand-reviewed, exhaustive record of one legitimate `app.use(...)` / `api.use(...)`
 * registration in `apps/api/src/index.ts`.
 *
 * `key` is the exact, unnormalised `METHOD path` Hono records for the registration (e.g.
 * `"ALL /*"`). `registrations` is how many entries Hono is expected to hold at that exact key
 * today — verified against the real router in `tests/permissions/route-coverage.test.ts`, not
 * assumed here.
 */
export type DeclaredRouterMiddleware = {
  readonly key: RouteKey;
  readonly registrations: number;
  readonly note: string;
};

/**
 * The only entries `isMiddlewareEntry` ever excludes from coverage.
 *
 * Reviewed by hand; growing this list is a decision, not an inference. Today it accounts for
 * the API's three genuine middleware registrations: `app.use("*", cors(...))`,
 * `app.use(compress())` (both `ALL /*`), and `api.use("*", <auth + Sentry guard>)` (`ALL
 * /api/*`, recorded under the `/api` mount).
 */
export const DECLARED_ROUTER_MIDDLEWARE: readonly DeclaredRouterMiddleware[] = [
  {
    key: "ALL /*",
    registrations: 2,
    note: 'apps/api/src/index.ts — app.use("*", cors(...)) and app.use(compress())',
  },
  {
    key: "ALL /api/*",
    registrations: 1,
    note: 'apps/api/src/index.ts — api.use("*", <Sentry isolation scope + authenticateApiRequest guard>)',
  },
];

/** A route whose path can match more than one endpoint. */
function isWildcardRoute(route: CollectedRoute): boolean {
  return route.path.includes("*");
}

function isAmbiguousWildcardAll(entry: HonoRouterEntry): boolean {
  return entry.method.toUpperCase() === "ALL" && entry.path.includes("*");
}

/** The exact, unnormalised key `DECLARED_ROUTER_MIDDLEWARE` is keyed on. */
function rawEntryKey(entry: HonoRouterEntry): RouteKey {
  return `${entry.method.toUpperCase()} ${entry.path}` as RouteKey;
}

/** How many `ALL`+wildcard registrations the router actually holds, grouped by raw key. */
function countAmbiguousEntries(app: HonoLikeApp): Map<RouteKey, number> {
  const counts = new Map<RouteKey, number>();
  for (const entry of app.routes) {
    if (!isAmbiguousWildcardAll(entry)) continue;
    const key = rawEntryKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Is this router entry one of the hand-reviewed, explicitly declared middleware
 * registrations?
 *
 * **Never inferred from handler arity.** `Function.length` cannot tell a real `(c, next)`
 * middleware from a terminal handler written `(c, _next) => …` that never calls `next` — and
 * it is exactly the shape Hono's own `app.mount(path, handler)` compiles to: method `ALL`, a
 * wildcarded path, and a two-argument handler (`async (c, next) => { const res = await
 * applicationHandler(...); if (res) return res; await next(); }`) that is itself
 * indistinguishable from ordinary middleware by shape alone. An opaque mount hiding dozens of
 * endpoints and a `(c, next) => …` that answers every request are the same arity as a CORS
 * wrapper — arity says nothing about whether anything behind that entry ever needs a policy.
 *
 * Instead: the entry's exact `METHOD path` key must appear on `DECLARED_ROUTER_MIDDLEWARE`,
 * *and* the router must hold precisely the declared number of registrations at that key — no
 * more, no fewer.
 *
 * - An entry at an **undeclared** key (a new mount, a new `.use()` nobody reviewed) is never
 *   treated as middleware: it flows into `collectRoutes` as an ordinary route and has to carry
 *   a policy like everything else. This is the fail-closed direction the invariant requires —
 *   an ambiguous wildcard is a route until a human says otherwise.
 * - An **extra** registration crowding an already-declared key (an accidental second `.use()`,
 *   or a mount that happens to land on the same path as a reviewed one) changes the count and
 *   voids the declaration for **every** entry sharing that key, rather than quietly keeping
 *   one of them exempt. The collision becomes a coverage failure, not a coincidence.
 *
 * This does not, and cannot, protect against a same-count *substitution* at a declared key
 * (swapping the genuine middleware for something else while holding the registration count
 * steady) — no signal available from `{ method, path, handler }` alone can prove identity, and
 * tagging the registration at its call site would mean editing `apps/api/src/index.ts`, which
 * this package does not reach into. What this closes is the concrete, demonstrated hole: a
 * route silently vanishing from coverage because someone happened to write its handler with
 * two parameters.
 */
export function isMiddlewareEntry(
  entry: HonoRouterEntry,
  actualCounts: ReadonlyMap<RouteKey, number>,
): boolean {
  if (!isAmbiguousWildcardAll(entry)) return false;
  const key = rawEntryKey(entry);
  const declared = DECLARED_ROUTER_MIDDLEWARE.find(
    (candidate) => candidate.key === key,
  );
  if (declared === undefined) return false;
  return actualCounts.get(key) === declared.registrations;
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
  const ambiguousCounts = countAmbiguousEntries(app);
  const byKey = new Map<RouteKey, { route: CollectedRoute; count: number }>();

  for (const entry of app.routes) {
    if (isMiddlewareEntry(entry, ambiguousCounts)) continue;

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
  const ambiguousCounts = countAmbiguousEntries(app);
  const keys = new Set<RouteKey>();
  for (const entry of app.routes) {
    if (!isMiddlewareEntry(entry, ambiguousCounts)) continue;
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
  /**
   * Wildcard surfaces nobody has declared. **Neither a policy nor a baseline entry clears
   * one**, and that separation is the point.
   *
   * Letting a wildcard be satisfied by an ordinary policy is the trap: one line —
   * `"ALL /api/legacy/*": { capability: "project:read", scope: "project" }` — turns the gate
   * green while an entire mounted application is nominally guarded by a single capability
   * check that none of its inner routes ever runs. That is not coverage; it is an invisible
   * surface repainted as a covered one, which is harder to spot than the original defect.
   * Letting the baseline clear one is the same trap with a shorter diff.
   *
   * So a wildcard carrying anything other than a `delegated` policy is neither covered nor
   * uncovered. It is unclassified, and the only way out is a `delegated` policy stating, in a
   * mandatory reason, that the surface behind it authenticates itself.
   */
  readonly unclassified: readonly CollectedRoute[];
  readonly bySurface: Readonly<
    Record<RouteSurface, { total: number; covered: number; uncovered: number }>
  >;
  readonly ok: boolean;
};

/**
 * Compare the router against the registry.
 *
 * Five ways to fail — `uncovered`, `baselineNowCovered`, `baselineStale`, `orphanedPolicies`
 * and `unclassified` all make `ok` false — and every one of them is an omission rather than a
 * mistake: v1's eleven authorization holes were every one of them an omission too. (This was
 * "four ways" before `unclassified` — the wildcard-surface classification below — was added;
 * update this count again if a sixth failure mode joins it.)
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

  const unclassified: CollectedRoute[] = [];

  for (const route of routes) {
    // A wildcard surface hides an unknown number of endpoints, so only ONE of the five
    // policy kinds can honestly cover it: `delegated`, which means "the surface behind
    // this authenticates itself" and carries a mandatory reason.
    //
    // Checked before the ordinary registry lookup, deliberately. Any other kind would
    // otherwise clear it, and that is the trap: one line —
    // `"ALL /api/legacy/*": { capability: "project:read", scope: "project" }` — turns the
    // gate green while an entire mounted application is nominally guarded by a single
    // capability check that none of its inner routes ever runs. An invisible surface
    // repainted as a covered one is harder to spot than the original defect. The baseline
    // cannot clear one either; that is the same trap with a shorter diff.
    if (isWildcardRoute(route)) {
      const entry = registry.get(route.routeKey);
      if (entry && isDelegatedPolicy(entry.policy)) {
        covered.push(route);
        if (baselineSet.has(route.routeKey)) {
          baselineNowCovered.push(route.routeKey);
        }
      } else {
        unclassified.push(route);
      }
      continue;
    }
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
    unclassified,
    covered,
    uncovered,
    knownUncovered,
    baselineNowCovered,
    baselineStale,
    orphanedPolicies,
    bySurface,
    ok:
      unclassified.length === 0 &&
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
  if (result.unclassified.length > 0) {
    lines.push("");
    lines.push(
      `UNCLASSIFIED WILDCARD SURFACES (${result.unclassified.length}) — a policy will NOT clear these, and neither will a baseline entry:`,
    );
    for (const route of result.unclassified) lines.push(`  ${route.routeKey}`);
    lines.push(
      "  Each hides an unknown number of endpoints. Either register concrete routes instead,",
    );
    lines.push(
      "  or give it a `delegated` policy whose reason says what authenticates the surface",
    );
    lines.push(
      "  behind it. No other policy kind, and no baseline entry, will clear one.",
    );
  }

  if (result.orphanedPolicies.length > 0) {
    lines.push("", "Policies whose route does not exist:");
    for (const key of result.orphanedPolicies) lines.push(`  ${key}`);
  }
  return lines.join("\n");
}
