/**
 * Issue #8, runtime-authorization-integration obligation: "a missing or invalid policy
 * cannot silently serve a request."
 *
 * This is deliberately narrower than full policy enforcement. Full ALLOW/DENY enforcement
 * (the registry's own `evaluatePolicy` verdict deciding the response) stays shadow-only,
 * per the 2026-09-23 decision log entry ("shadow until clean, then strict") -- it cuts over
 * one router group at a time, only after a clean 7-day UAT soak, and that soak has not run
 * yet. What this guard adds instead is a presence check: every route below the app-wide
 * auth guard must resolve to SOME entry in the declarative policy registry, or the request
 * is refused outright. It never inspects what the entry says (public/delegated/capability/
 * self/portal) and never evaluates a capability decision -- it only refuses the one case
 * that must never happen silently: a route with NO entry at all reaching a handler.
 *
 * In today's registry this is a no-op for every real request: issue #259 classified every
 * retained route (`tests/permissions/route-coverage.test.ts` enforces that at CI), so no
 * below-guard route currently lacks an entry. This is the runtime backstop for the day that
 * invariant breaks anyway -- a route added without a matching registry update slipping past
 * review, a merge race, a future coverage-test regression -- so the failure is a loud 500 at
 * request time, never a silently served response.
 *
 * Routes registered ABOVE the auth guard (H2, `docs/07-planning/security-reviews/
 * 21-policy-registry.md`) never reach this guard at all -- same reasoning as
 * `shadow-middleware.ts`'s own doc comment: they are exactly the routes `policy-registry.ts`
 * already enumerates as public/delegated by design.
 *
 * Reuses `attributedMatchedRoute` from `shadow-middleware.ts` (Hono dispatches the FIRST
 * matched route when a literal and a parameter route both match; see that function's own
 * doc comment for the instrumented evidence) rather than a second implementation of the same
 * attribution logic.
 *
 * **Opus delta (this PR, B1/B2): a matched route that could not be keyed must still refuse,
 * not be swallowed.** The earlier version called `attributedRouteKey` directly and treated
 * its `null` return (no route matched AT ALL, and a route matched but its key could not be
 * normalised) the same way -- silently letting the request through. That fail-open two ways:
 * a route reachable only via `.all()`/`.mount()`, and a route registered under a custom HTTP
 * method `normaliseRouteKey` does not recognise. This guard now asks
 * `attributedMatchedRoute` for the raw matched entry first, so it can tell "genuinely
 * unmatched" (a real 404, nothing to check) apart from "matched, but the key computation
 * itself failed" (refuse -- the route exists and was never classified as anything).
 *
 * **Fresh Opus delta pass (B3, live-reproduced): a route-scoped `.use()` middleware
 * registered ahead of the real handler was itself being treated as "the" attributed
 * route** -- its own key is not one of the two framework-declared catch-alls, so the old
 * single-entry lookup picked IT, and whatever registry entry existed for that middleware's
 * key gated every unclassified route behind it instead of the real handler's own (missing)
 * entry. Fixed by checking every entry `attributedRoutesToClassify` collects (every scoped
 * `ALL`-method middleware met along the way, plus the terminal non-`ALL` route it stops
 * at) -- not just the first one -- so a route hiding behind a classified ambient
 * middleware can no longer borrow that middleware's clearance.
 */

import { normaliseRouteKey } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { policyRegistry } from "../policy-registry";
import { attributedRoutesToClassify } from "./shadow-middleware";

function refuseUnclassified(reason: string): never {
  console.error(
    `policy registry: ${reason}; refusing request rather than serving it unclassified`,
  );
  throw new HTTPException(500, { message: "Internal Server Error" });
}

/**
 * Throws `HTTPException(500)` if any matched entry the request dispatched through --
 * every scoped `ALL`-method middleware ahead of the real route, and the terminal route
 * itself -- has no entry in the policy registry, or if any of their keys could not even be
 * computed. A route Hono could not match at all (no matched entry -- a genuine 404) is not
 * refused here; it has no route to check a policy against, and the guard's own coverage
 * lives at `route-coverage.test.ts`, not here.
 */
export function assertRouteIsClassified(c: Context): void {
  const routes = attributedRoutesToClassify(c);

  for (const matched of routes) {
    let routeKey: string;
    try {
      routeKey = normaliseRouteKey(`${matched.method} ${matched.path}`);
    } catch (error) {
      refuseUnclassified(
        `matched route "${matched.method} ${matched.path}" has no valid route key (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }

    if (policyRegistry.get(routeKey) === undefined) {
      refuseUnclassified(`no entry for ${routeKey}`);
    }
  }
}
