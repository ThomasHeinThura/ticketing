import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Instance-surface route policies.
 *
 * Every route under `/api/instance/*` is caught by the elevation rule: it must declare
 * `elevated: true`, or `elevated: false` with a written reason. A new authority-minting route
 * that nobody remembered to list therefore fails the build instead of shipping unprotected
 * (`docs/01-architecture/rbac.md`, elevation coverage test).
 */
export const instancePolicies = {
  // First-run bootstrap: the sign-in screen asks whether the instance has any users yet, and
  // when it has none the next sign-up becomes the instance admin. Inherited from kaneo as an
  // anonymous route — it is registered above the authentication middleware — and declared here
  // so that "public" is a stated, reviewable act rather than a consequence of line ordering.
  // #8 re-confirms this against the retained surface, and the P0 security review reads every
  // public reason.
  "GET /api/instance/status": {
    public: true,
    reason:
      "first-run bootstrap — the sign-in screen needs to know whether the instance has any users",
    elevated: false,
    // Two booleans, not one: `hasUsers` and `hasAdmin`, filtered on `role = 'admin'`
    // (`controllers/get-instance-status.ts`). This route itself grants nothing and changes
    // nothing — reading it performs no write and requires no authority. But `hasUsers ===
    // false` is exactly the signal that makes the *next* unauthenticated sign-up become the
    // instance admin (`apps/api/src/auth.ts`'s registration `after` hook, ~line 660) — this
    // route is how a caller learns whether that bootstrap window is currently open. Whether
    // that auto-promotion behaviour itself is the right design is issue #18's question, which
    // is open; this exemption only says why *this read* needs no fresh authentication, not
    // that the bootstrap flow it observes has been reviewed.
    elevationExemptionReason:
      "reads two booleans about setup state (hasUsers, hasAdmin); it grants nothing and changes nothing itself — the bootstrap auto-promotion behaviour hasUsers=false signals is issue #18's open concern, not this route's",
  },
} as const satisfies PolicyMap;
