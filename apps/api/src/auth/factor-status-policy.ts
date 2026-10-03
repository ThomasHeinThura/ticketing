import type { PolicyMap } from "@taskdesk/permissions";

export const factorStatusPolicies = {
  "GET /api/me/csrf-token": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns a short-lived CSRF token bound to the current agent session",
    },
  },
  "GET /api/me/security/factors": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason: "returns only the current session user's factor status",
    },
  },
  "POST /api/me/step-up/challenges": {
    authenticated: true,
    sessionOnly: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason: "challenge is bound to the current session's own active person",
    },
  },
  "POST /api/me/step-up": {
    authenticated: true,
    sessionOnly: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason: "proof is bound to the current session's own active person",
    },
  },
} as const satisfies PolicyMap;
