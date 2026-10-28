import type { PolicyMap } from "@taskdesk/permissions";

const base = {
  capability: "instance:manage_plugins",
  scope: "instance",
  scopeSource: "instance",
  reach: {
    exempt: "no_single_resource",
    reason: "Instance-wide SMTP provider configuration has no tenant resource",
  },
  elevated: false,
  elevationExemptionReason:
    "This configures the non-auth notify.email provider; it grants no identity, role or tenant reach",
} as const;
export const notificationProviderPolicies = {
  "GET /api/instance/notification-providers/email": base,
  "PATCH /api/instance/notification-providers/email": {
    ...base,
    sessionOnly: true,
  },
  "POST /api/instance/notification-providers/email/test": {
    ...base,
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
