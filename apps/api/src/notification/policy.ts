import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Notification route policies (issue #8, `notification` lane).
 *
 * Mounted at `apps/api/src/index.ts:789`, below the app-wide auth guard (line 755) — H2 does
 * not constrain any route here.
 *
 * **All five routes are `self`, kind 2 — every one of them reads or writes only the CALLING
 * session's own notification rows, and none names another person.** `apps/api/src/notification/
 * index.ts` carries no `workspaceAccess`/`requireWorkspacePermission` middleware at all; every
 * controller (`apps/api/src/notification/controllers/*`) takes `userId` as a plain function
 * argument and every call site passes `c.get("userId")` — the resolved caller's own id, never
 * a client-supplied one. Confirmed by reading each query, not assumed from the route path
 * (these routes are NOT under `/api/me/*` — `policy.ts`'s own doc comment for `SelfPolicy` says
 * "kind 2 ... (`/api/me/*`)" as the typical shape, but nothing in `registry.ts`'s
 * `personParamProblems` or anywhere else in `packages/permissions` actually restricts kind 2 to
 * that path prefix, and `workspace/policy.ts` already declares `self` for several routes
 * outside `/api/me/*` — e.g. `POST /api/workspace`, `POST /api/workspace/{id}/activate` — on
 * exactly this reasoning: the policy KIND follows from what the route actually reads/writes,
 * not from its path):
 *
 * - `GET /api/notification` (`getNotifications`) — `WHERE notificationTable.userId = userId`.
 * - `POST /api/notification` (`createNotification`) — inserts `userId: c.get("userId")`;
 *   `createNotificationBody` (`./schema.ts`) has no `userId` field at all, so there is no way
 *   for a caller to target anyone else even in principle — confirmed from the Zod schema, not
 *   inferred from the handler.
 * - `PATCH /api/notification/{id}/read` (`markNotificationAsRead`) — `WHERE id = :id AND
 *   userId = caller`; the `{id}` path parameter names the notification, not a person, so
 *   `personParam` below states the `no_person_parameter` exemption, same as every write route
 *   in `workspace/policy.ts` that names a resource by id rather than a person.
 * - `PATCH /api/notification/read-all` (`markAllNotificationsAsRead`) — `WHERE userId = caller`,
 *   no id at all.
 * - `DELETE /api/notification/clear-all` (`clearNotifications`) — `WHERE userId = caller`, no
 *   id at all.
 *
 * No route here is `capability`-kind: there is no separate resource whose authority is being
 * checked against a capability held in some other scope — the caller's OWN notification rows
 * are not a scope in `packages/permissions/src/policy.ts`'s `SCOPES` list at all (they are
 * per-user, not per-tenant), which is exactly what kind 2 exists for.
 *
 * No `elevated`/`AUTHORITY_GRANTING` concern (notifications mint no authority) and no
 * `sessionOnly` (kaneo-native route, no inherited session-only restriction — see
 * `comment/policy.ts`'s file comment for the same reasoning, not repeated per file).
 */
export const notificationPolicies = {
  "GET /api/notification": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns the caller's own notifications; the route names no person parameter because the caller is the person",
    },
  },

  "POST /api/notification": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "creates a notification for the caller; createNotificationBody has no userId field, so the caller cannot target anyone else",
    },
  },

  "PATCH /api/notification/{id}/read": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "marks one of the caller's own notifications read (WHERE id = :id AND userId = caller); the {id} parameter names the notification, not a person",
    },
  },

  "PATCH /api/notification/read-all": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "marks every one of the caller's own notifications read; the route names no person parameter because the caller is the person",
    },
  },

  "DELETE /api/notification/clear-all": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "deletes every one of the caller's own notifications; the route names no person parameter because the caller is the person",
    },
  },
} as const satisfies PolicyMap;
