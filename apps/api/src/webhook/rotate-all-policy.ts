import type { PolicyMap } from "@taskdesk/permissions";

/** Pure route data; the policy registry must not import an OpenAPI router at runtime. */
export const webhookRotateAllPolicies = {
  "GET /api/instance/webhooks/rotation-targets": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "bounded list of safe metadata for all current webhook rotation targets",
    },
    elevated: false,
    elevationExemptionReason:
      "read-only current webhook IDs, names, workspace labels, and versions only",
    sessionOnly: true,
  },
  "POST /api/instance/webhooks/rotate-secrets": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "incident rotation applies atomically to the exact current webhook set",
    },
    elevated: true,
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
