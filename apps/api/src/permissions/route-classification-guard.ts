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
 * Reuses `attributedRouteKey` from `shadow-middleware.ts` (Hono dispatches the FIRST matched
 * route when a literal and a parameter route both match; see that function's own doc comment
 * for the instrumented evidence) rather than a second implementation of the same attribution
 * logic.
 */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { policyRegistry } from "../policy-registry";
import { attributedRouteKey } from "./shadow-middleware";

/**
 * Throws `HTTPException(500)` if the dispatched route has no entry in the policy registry.
 * A route Hono could not attribute (no non-`ALL` matched route -- should not happen for a
 * real request below the guard) is not refused here; it has no route to check a policy
 * against, and the guard's own coverage lives at `route-coverage.test.ts`, not here.
 */
export function assertRouteIsClassified(c: Context): void {
  const routeKey = attributedRouteKey(c);
  if (routeKey === null) {
    return;
  }
  if (policyRegistry.get(routeKey) === undefined) {
    console.error(
      `policy registry: no entry for ${routeKey}; refusing request rather than serving it unclassified`,
    );
    throw new HTTPException(500, { message: "Internal Server Error" });
  }
}
