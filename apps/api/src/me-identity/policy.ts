import type { PolicyMap } from "@taskdesk/permissions";

export const meIdentityPolicies = {
  "GET /api/me/identity": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason: "returns only the authenticated user's own staff identity",
    },
  },
} as const satisfies PolicyMap;
