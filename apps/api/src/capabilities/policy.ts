import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Capability-map self-introspection is membership-gated rather than capability-gated. A
 * member can learn that each capability is false when their role is unknown or malformed;
 * that response grants no permission. `transitionTasks`, `rankTasks` and
 * `manageProjectSettings` are computed from the strict canonical capabilities
 * (`work_item:transition`, `work_item:rank`, `project:manage_settings`) intersected with API-key
 * scope, never from the legacy statement map. The route requires a session and the exact persisted
 * workspace membership, not instance-admin reach. See rbac.md § Route policies.
 */
export const capabilitiesPolicies = {
  "GET /api/capabilities": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "the route reports only the authenticated caller's own capability map",
    },
    workspaceMembership: true,
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
