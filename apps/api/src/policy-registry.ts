/**
 * The route-policy registry, assembled.
 *
 * Every feature folder owns a `policy.ts` exporting a `PolicyMap`; this file is the list of
 * them, plus the policies for the surfaces that are registered directly on the app in
 * `index.ts` and so have no feature folder of their own — the `/auth/*` mount, the websocket
 * upgrade routes and the health probe.
 *
 * `tests/permissions/route-coverage.test.ts` walks **Hono's actual router** and fails on any
 * route that is not in here. Adding a route without a policy therefore fails the build, which
 * is the whole point of ADR 0010 and the reason issue #7 gates Throttle 1.
 *
 * **Scope note.** The inherited kaneo surface is not classified here. Final route-by-route
 * classification of what survives #6 belongs to #8, and every inherited route still awaiting a
 * verdict is listed in `tests/permissions/inherited-uncovered.json`, which shrinks to nothing
 * as #8 lands. What is declared below is the machinery's proof of life: one of each surface
 * the coverage test has to account for.
 */

import {
  createPolicyRegistry,
  type PolicyMap,
  type PolicyRegistry,
} from "@taskdesk/permissions";
import { instancePolicies } from "./instance/policy";
import { projectPolicies } from "./project/policy";

/**
 * Routes registered directly on the app rather than in a feature router.
 *
 * These are exactly the surfaces the OpenAPI document cannot see, which is why the coverage
 * test enumerates the router instead.
 */
export const platformPolicies = {
  // The better-auth mount. One handler; its endpoint set is the plugin list, rebuilt at
  // runtime from database configuration, so the router shows a wildcard where dozens of
  // endpoints live. The allowlist assertion in better-auth-plugin-list.test.ts is what
  // closes that gap — this entry only records that the mount is a deliberate delegation.
  "GET /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "POST /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "PUT /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "PATCH /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "DELETE /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },

  // The websocket surface. The upgrade handler authenticates the request itself before the
  // socket opens; there is no Hono response for a policy middleware to shape.
  "GET /api/ws/user": {
    delegated: "websocket",
    reason:
      "websocket upgrade; the handler authenticates the session before the socket opens",
  },
  "GET /api/ws/{projectId}": {
    delegated: "websocket",
    reason:
      "websocket upgrade; the handler authenticates the session before the socket opens",
  },

  // The liveness probe. Returns a constant, reads nothing.
  "GET /api/health": {
    public: true,
    reason:
      "liveness probe for the container runtime and load balancer; returns a constant",
  },
} as const satisfies PolicyMap;

export const POLICY_SOURCES = [
  {
    name: "apps/api/src/policy-registry.ts (platform)",
    policies: platformPolicies,
  },
  { name: "apps/api/src/instance/policy.ts", policies: instancePolicies },
  { name: "apps/api/src/project/policy.ts", policies: projectPolicies },
];

/**
 * Built once, at module load, so an invalid entry fails at boot rather than at request time
 * (ADR 0010 §1).
 */
export const policyRegistry: PolicyRegistry =
  createPolicyRegistry(POLICY_SOURCES);
