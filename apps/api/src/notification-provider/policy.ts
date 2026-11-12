import type { PolicyMap } from "@taskdesk/permissions";

const base = {
  capability: "instance:manage_plugins",
  scope: "instance",
  scopeSource: "instance",
  reach: {
    exempt: "no_single_resource",
    reason: "Instance-wide SMTP provider configuration has no tenant resource",
  },
} as const;
export const notificationProviderPolicies = {
  "GET /api/instance/notification-providers/email": {
    ...base,
    sessionOnly: true,
    elevated: false,
    elevationExemptionReason:
      "Read-only; the SMTP password is never returned, only whether one is stored",
  },
  // Mail carries password-reset and invitation links, so changing where it is sent from needs
  // the administrator's second factor again (12 Nov 2026 owner decision, C-1). Enforced by
  // `runWithStepUp` in `index.ts`; classified in `auth/elevated-enforcement.ts`.
  "PATCH /api/instance/notification-providers/email": {
    ...base,
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/instance/notification-providers/email/test": {
    ...base,
    elevated: false,
    elevationExemptionReason:
      "Sends one fixed message and may record its test status without changing settings; rate limited to 5 per administrator per minute and audited with the recipient's domain only",
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
