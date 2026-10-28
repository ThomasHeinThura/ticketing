import type { PolicyMap } from "@taskdesk/permissions";

export const IDENTITY_CONNECTION_DELETION_ROUTE =
  "DELETE /api/instance/identity-connections/{id}" as const;

export const identityConnectionDeletionPolicies = {
  [IDENTITY_CONNECTION_DELETION_ROUTE]: {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "current instance administrators delete identity connections through exact-target pending approval",
    },
    elevated: true,
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
