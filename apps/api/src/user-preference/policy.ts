import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Per-user settings routes (`docs/03-features/settings-hierarchy.md`, `ST-12`..`ST-17`; the
 * Profile level, `GET/PATCH /api/me/settings`).
 *
 * Both routes are `authenticated + self` (kind 2): every read and write is keyed on the
 * authenticated caller's own `person_id`; no client-supplied id ever selects whose rows are
 * touched. `layout.<projectId>` names a PROJECT the row is about, not a person.
 *
 * For `layout.<projectId>` the service additionally requires the caller to reach that project
 * (`resolveIdentity` + `reaches`, 404 when it does not, `ST-14`) before reading or writing
 * the row. This is a controller-level check, not route middleware, exactly as
 * `notification-preferences/policy.ts` documents for its `assertWorkspaceMembership`; it does
 * not change the policy kind.
 *
 * The `PATCH` is session-only under the 2026-10-06 decision (self-only personal writes stay
 * session-only until explicit API-key scopes exist): an API key, MCP key or impersonation
 * session gets `403 session_required` before validation. The `GET` stays open to keys, like
 * `GET /api/notification-preferences`, because it only returns the owner's own rows.
 */
export const userPreferencePolicies = {
  "GET /api/me/settings": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns only the authenticated caller's own settings rows; keys name a setting or a project, never a person",
    },
  },

  "PATCH /api/me/settings": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "updates only the authenticated caller's own settings rows, after confirming the caller reaches every project a layout key names; keys name a setting or a project, never a person",
    },
  },
} as const satisfies PolicyMap;
