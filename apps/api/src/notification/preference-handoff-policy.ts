import type { PolicyMap } from "@taskdesk/permissions";
export const preferenceHandoffPolicies = {
  "POST /api/public/agent/notification-preference-handoffs": {
    public: true,
    reason:
      "NO-2 signed single-purpose preference selector exchange; anonymous exact-origin requests receive a generic response; ambient sessions additionally require double-submit CSRF; no preference read or mutation",
  },
  "POST /api/public/portal/notification-preference-handoffs": {
    public: true,
    reason:
      "NO-2 customer-audience signed selector exchange, exact portal origin and ambient-session double-submit CSRF; no preference read or mutation",
  },
  "GET /api/notification-preferences/email-link-handoff": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns only a verified agent-audience selector bound to the current staff person; never consumes the handoff or changes a preference",
    },
  },
  "GET /api/portal/notification-preferences/email-link-handoff": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns only a verified customer-audience selector bound to the current portal person; host and current customer session are enforced",
    },
  },
} as const satisfies PolicyMap;
