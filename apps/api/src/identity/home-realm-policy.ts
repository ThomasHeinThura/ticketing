import type { PolicyMap } from "@taskdesk/permissions";

export const homeRealmPolicies = {
  "POST /api/portal/sign-in/home-realm": {
    public: true,
    reason:
      "portal-host-only typed-domain discovery; response reveals only local or SSO routing",
  },
  "GET /api/portal/sign-in/home-realm/start": {
    public: true,
    reason:
      "portal-host-only fixed OIDC start consumes an encrypted server-selected continuation",
  },
} as const satisfies PolicyMap;
