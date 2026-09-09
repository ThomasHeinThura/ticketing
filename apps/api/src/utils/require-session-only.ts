import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Session-only enforcement, applied at request time.
 *
 * **Why this file exists instead of a policy declaration alone.** `packages/permissions`
 * already models a `sessionOnly` policy flag (`policy.ts`) and an evaluator that refuses a
 * non-session credential with `403 session_required` (`evaluator.ts`) -- but nothing in
 * `apps/api/src/index.ts` imports `policyRegistry` or `evaluatePolicy` today
 * (`apps/api/src/policy-registry.ts`'s own docstring, confirmed by
 * `grep -rn "policy-registry" apps/api/src` returning only this file's own definition).
 * Wiring the registry into the live request path is runtime authorization integration and is
 * issue #8's, not this lane's -- this lane may not redesign the registry's types or evaluator.
 * Declaring `sessionOnly: true` in a `policy.ts` file alone would therefore be **inert
 * metadata**: true on paper, unread by anything that runs. This module is the small, additive
 * piece of enforcement that makes the same restriction real in the runtime that ships on this
 * branch, using the context variables the current runtime actually has
 * (`apps/api/src/utils/authenticate-api-request.ts`), not the future `ResolvedIdentity` shape.
 *
 * **What "session-only" preserves.** The four routes this middleware guards are native
 * replacements for reads the still-mounted better-auth `organization()` plugin used to serve.
 * That plugin is configured `enableSessionForAPIKeys: false` (`apps/api/src/auth.ts`), so an
 * API key never became a session there -- `/organization/*` was, in effect, session-only. Every
 * route added below the app-wide auth guard in `index.ts` is reachable by API key too
 * (retrofit plan, risk R10), so without this guard the four new routes would silently *widen*
 * reach relative to what they replace. The architecture default (2026-09-08) is to preserve
 * that inherited restriction, not widen it ahead of a deliberate runtime-policy decision.
 *
 * **Credential kinds refused.** Mirrors the four-kind model `packages/permissions/src/
 * identity.ts` documents (`session` / `api_key` / `mcp_key` / `impersonation`), translated to
 * what the current runtime can actually observe:
 * - `c.get("apiKey")` set -- an API key (`x-api-key` header, or a Bearer token that resolved to
 *   one). The current runtime has no separate `mcp_key` credential kind of its own (there is
 *   no `is_mcp` concept in `apps/api/src/utils/verify-api-key.ts`); every API key is refused
 *   here, which is a superset of refusing `mcp_key` alone and cannot under-refuse it.
 * - `session.impersonatedBy` set -- an impersonation session. No `admin()` / impersonation
 *   plugin is mounted in `apps/api/src/auth.ts` today (`grep -rn "admin(" apps/api/src/auth.ts`
 *   finds nothing), so this branch is currently unreachable. Kept as defence in depth: the
 *   column already exists on `session` (inherited from better-auth), and refusing it now costs
 *   nothing and closes the gap the moment such a plugin is ever mounted, rather than waiting
 *   for that to be a fresh finding.
 * - no `session` at all -- the app-wide guard (`index.ts`) already requires *some*
 *   authenticated caller before any route runs, so this is defence in depth, not the primary
 *   check; a session-only route reaching here with neither an API key nor a session is refused
 *   rather than assumed innocent.
 *
 * A real browser session (cookie or better-auth bearer session token; both populate
 * `c.get("session")` with `apiKey` absent) is the only credential this middleware accepts.
 */
export function requireSessionOnly() {
  return async (c: Context, next: Next) => {
    if (c.get("apiKey")) {
      throw new HTTPException(403, {
        message:
          "session_required: this route accepts a browser session only, not an API key",
      });
    }

    const session = c.get("session") as {
      impersonatedBy?: string | null;
    } | null;

    if (!session) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    if (session.impersonatedBy) {
      throw new HTTPException(403, {
        message:
          "session_required: this route accepts a browser session only, not an impersonation session",
      });
    }

    return next();
  };
}
