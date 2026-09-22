import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Notification-preferences route policies (issue #8, `notification-preferences` lane).
 *
 * Mounted at `apps/api/src/index.ts:790`, below the app-wide auth guard (line 755) — H2 does
 * not constrain any route here.
 *
 * **All four routes are `self`, kind 2 — every one reads or writes only the CALLING session's
 * own preference/rule rows.** `apps/api/src/notification-preferences/index.ts` carries no
 * `workspaceAccess`/`requireWorkspacePermission` middleware; every route handler passes
 * `c.get("userId")` (never a client-supplied id) into `./service.ts`'s functions, each of which
 * reads/writes `userNotificationPreferenceTable`/`userNotificationWorkspaceRuleTable` keyed on
 * that `userId`:
 *
 * - `GET /api/notification-preferences` (`getNotificationPreferences`) — `WHERE userId = caller`.
 * - `PUT /api/notification-preferences` (`updateNotificationPreferences`) — upserts keyed on
 *   `userId: caller`.
 * - `PUT /api/notification-preferences/workspaces/{workspaceId}` (`upsertWorkspaceRule`) —
 *   upserts `WHERE userId = caller AND workspaceId = :workspaceId`.
 * - `DELETE /api/notification-preferences/workspaces/{workspaceId}` (`deleteWorkspaceRule`) —
 *   deletes `WHERE userId = caller AND workspaceId = :workspaceId`, 404 if no such rule exists
 *   for the caller.
 *
 * **The two `.../workspaces/{workspaceId}` routes additionally call `assertWorkspaceMembership`
 * (`service.ts`)** before touching the rule row — a genuine, controller-level (not
 * route-middleware) check that the caller belongs to the named workspace, refusing 403
 * otherwise. This does not change the policy kind: `{workspaceId}` still names a WORKSPACE, not
 * a person, and the row being read/written is still exclusively the caller's own — exactly the
 * same shape `workspace/policy.ts` already classifies `self` for
 * `POST /api/workspace/{workspaceId}/activate` ("sets the caller's own active workspace
 * pointer"), which also gates on workspace membership before writing a caller-owned row.
 * `personParam` below states the `no_person_parameter` exemption on both routes for the same
 * reason: `{workspaceId}` is not a person parameter.
 *
 * **`assertWorkspaceMembership` runs only inside the service layer, with no `workspaceAccess.*`
 * middleware backing it at the route** — unlike every workspace-membership check in
 * `workspace/policy.ts`'s routes (which all sit behind `workspaceAccess.fromParam()` or
 * equivalent before the handler runs). Functionally equivalent today (the service function is
 * always reached through these two routes and always called before any row is touched), but
 * worth naming: a future edit to `service.ts` that reorders these calls, or a second route
 * added that calls `upsertWorkspaceRule`/`deleteWorkspaceRule` directly, would not get this
 * check "for free" the way route middleware does. Not a defect in what exists today, and not
 * fixed here (changing route wiring is outside a pure classification pass) — flagged for the
 * security review.
 *
 * No `capability` kind anywhere in this file for the same reason as `notification/policy.ts`:
 * the caller's own preference rows are not one of `SCOPES` in `packages/permissions/src/
 * policy.ts` — they are per-user configuration, not a tenant-scoped resource with a capability
 * held in some other scope. No `elevated`/`AUTHORITY_GRANTING` concern and no `sessionOnly`,
 * same reasoning as the other four files in this lane.
 */
export const notificationPreferencesPolicies = {
  "GET /api/notification-preferences": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns the caller's own notification preferences; the route names no person parameter because the caller is the person",
    },
  },

  "PUT /api/notification-preferences": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "updates the caller's own global notification preferences; the route names no person parameter because the caller is the person",
    },
  },

  "PUT /api/notification-preferences/workspaces/{workspaceId}": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "creates or replaces the caller's own per-workspace notification rule, after assertWorkspaceMembership confirms the caller belongs to {workspaceId}; {workspaceId} names a workspace, not a person",
    },
  },

  "DELETE /api/notification-preferences/workspaces/{workspaceId}": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "removes the caller's own per-workspace notification rule, after assertWorkspaceMembership confirms the caller belongs to {workspaceId}; {workspaceId} names a workspace, not a person",
    },
  },
} as const satisfies PolicyMap;
