import type { PolicyMap } from "@taskdesk/permissions";

export const portalCanonicalPreferencesPolicies = {
  "GET /api/portal/notification-preferences/canonical": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "reads only the current customer's global notification preferences; the customer person is resolved from the portal session",
    },
  },
  "PUT /api/portal/notification-preferences/canonical": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "updates only the current customer's global notification preference; the customer person is resolved from the portal session",
    },
  },
} as const satisfies PolicyMap;
