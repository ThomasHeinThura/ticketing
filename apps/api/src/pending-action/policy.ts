import type { PolicyMap } from "@taskdesk/permissions";

export const pendingActionPolicies = {
  "GET /api/me/pending-actions": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "lists only pending actions owned by the authenticated caller's person record",
    },
  },
  "GET /api/me/pending-actions/{id}": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "reads only an action owned by the authenticated caller; id names the action, not a person",
    },
  },
} as const satisfies PolicyMap;
