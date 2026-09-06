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
    elevationExemptionReason:
      "reads one boolean about setup state; it grants nothing and changes nothing",
  },
} as const satisfies PolicyMap;
