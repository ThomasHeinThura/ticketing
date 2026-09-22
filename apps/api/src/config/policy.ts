import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Config route policy.
 *
 * `GET /api/config` (`apps/api/src/config/index.ts`) is mounted at
 * `const configApi = api.route("/config", config);` in `apps/api/src/index.ts` -- BEFORE
 * `api.use("*", ...)` (the app-wide `authenticateApiRequest` guard, `AUTH_GUARD_KEY =
 * "ALL /api/*"` in `packages/permissions/src/route-coverage.ts`) is registered a few hundred
 * lines further down the same file. Verified directly by reading the registration order in
 * `index.ts`, not assumed from the router's name.
 *
 * H2 (issue #8, resolved by PR #163) makes this a hard refusal, not a judgement call: a route
 * registered above the guard can only be `public` or `delegated` -- `route-coverage.ts`'s
 * `isWithinAuthGuardScope()` refuses a `capability`/`self`/`portal` policy on it outright, at
 * coverage-compute time, regardless of what this file declares. `delegated` is closed to
 * `better-auth`/`websocket`/`metrics`/`scim` (`DELEGATED_SURFACES`,
 * `packages/permissions/src/policy.ts`) and config is none of those, so `public` is the only
 * kind this route can take.
 *
 * It is also the right kind on the merits, not merely the only one left standing: the route's
 * own doc comment says why --  "Mounted before the app-wide authenticateApiRequest middleware:
 * the login screen reads it to decide which sign-in methods to render" -- and its handler
 * (`getSettings()`) returns only instance-wide, non-secret configuration (which sign-in
 * methods, registration paths and features are enabled), the same class of pre-authentication
 * bootstrap data `GET /api/instance/status` and `GET /api/openapi` already serve publicly.
 * `createRoute` declares `security: []` on it already, consistent with this.
 *
 * `elevated` is not declared: the ElevationFlags rule demands a written `elevated: false`
 * exemption only for a route under `/api/instance/*` or one gated on an
 * `AUTHORITY_GRANTING` capability (`packages/permissions/src/elevated.ts`,
 * `apps/api/src/instance/policy.ts`'s own comment). This route is neither -- it is public and
 * grants no authority at all -- so `PublicElevationFlags`'s first branch (both `elevated` and
 * `elevationExemptionReason` omitted) is the honest declaration, matching
 * `apps/api/src/project/policy.ts`'s precedent of omitting `elevated` entirely where it does
 * not apply.
 */
export const configPolicies = {
  "GET /api/config": {
    public: true,
    reason:
      "instance-wide, non-secret settings (enabled sign-in methods, registration paths, feature flags) the login screen must read before the caller has any credential at all; registered above the app-wide auth guard for exactly that reason, and H2 refuses this route any policy kind but public or delegated",
  },
} as const satisfies PolicyMap;
