import type { PolicyMap } from "@taskdesk/permissions";

const ownSession = {
  authenticated: true,
  self: true,
  sessionOnly: true,
  personParam: {
    exempt: "no_person_parameter",
    reason:
      "identity links are scoped to the exact authenticated SSO session and its current person",
  },
} as const;

export const accountLinkPolicies = {
  "GET /api/me/identity-links": ownSession,
  "POST /api/me/identity-links/{targetConnectionId}/start": ownSession,
  "GET /api/me/identity-links/intents/{intentId}": ownSession,
  "POST /api/me/identity-links/intents/{intentId}/confirm": ownSession,
} as const satisfies PolicyMap;
