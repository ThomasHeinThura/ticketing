import type { PolicyMap } from "@taskdesk/permissions";

const selfSession = {
  authenticated: true,
  self: true,
  sessionOnly: true,
  personParam: {
    exempt: "no_person_parameter",
    reason:
      "the notification recipient is derived from the authenticated customer portal session",
  },
} as const;

export const portalNotificationPolicies = {
  "GET /api/portal/notification/inbox": selfSession,
  "PATCH /api/portal/notification/{id}/read": selfSession,
  "PATCH /api/portal/notification/{id}/unread": selfSession,
  "PATCH /api/portal/notification/read-all": selfSession,
} as const satisfies PolicyMap;
