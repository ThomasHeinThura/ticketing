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
  "POST /api/me/pending-actions/{id}/deny": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "denies only an action owned by the authenticated caller; id names the action, not a person",
    },
  },
  "POST /api/me/pending-actions/{id}/approve": {
    authenticated: true,
    self: true,
    elevated: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "approves only the caller's pending action; the id names an action, not a person",
    },
  },
  "POST /api/me/pending-actions/{id}/cancel": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "cancels only an action owned by the authenticated caller; id names the action, not a person",
    },
  },
} as const satisfies PolicyMap;
