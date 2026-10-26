import type { PolicyMap } from "@taskdesk/permissions";

export const securityHeaderPolicies = {
  "POST /api/public/csp-report": {
    public: true,
    reason:
      "bounded CSP violation diagnostics only; no submitted report fields or caller identity are retained, and trusted-IP anonymous rate limiting applies",
  },
} as const satisfies PolicyMap;
