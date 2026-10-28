import type { PolicyMap } from "@taskdesk/permissions";

/** Pure registry data; keep router/OpenAPI runtime imports out of the policy registry graph. */
export const webhookSecurityPosturePolicies = {
  "GET /api/instance/webhooks/security-posture": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "current instance administrators inspect secret-free metadata for webhooks whose current owner has full reach",
    },
    elevated: false,
    elevationExemptionReason:
      "read-only, bounded webhook security-posture inventory; it returns no URL, secret, or delivery content",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
