import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Per-user preference routes (`docs/03-features/views.md` "Preference routes", PREF-1..8).
 *
 * Both routes are `authenticated + self` (kind 2): every read and write is keyed on the
 * authenticated caller's own `person_id`; no client-supplied id ever selects whose rows are
 * touched. `{scope}` and `scopeId` name a WORKSPACE or PROJECT the row is about, not a person.
 *
 * For `workspace` and `project` scope the service additionally requires the caller to reach
 * that scope (`resolveIdentity` + `reaches`, 404 when it does not, PREF-6) before reading or
 * writing the row. This is a controller-level check, not route middleware, exactly as
 * `notification-preferences/policy.ts` documents for its `assertWorkspaceMembership`; it does
 * not change the policy kind.
 *
 * The `PUT` is session-only under the 2026-10-06 decision (self-only personal writes stay
 * session-only until explicit API-key scopes exist): an API key, MCP key or impersonation
 * session gets `403 session_required` before validation. The `GET` stays open to keys, like
 * `GET /api/notification-preferences`, because it only returns the owner's own rows.
 */
export const userPreferencePolicies = {
  "GET /api/me/preferences": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns only the authenticated caller's own preference rows; scope/scopeId name a workspace or project, never a person",
    },
  },

  "PUT /api/me/preferences/{scope}/{key}": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "upserts only the authenticated caller's own preference row, after confirming the caller reaches the named workspace or project; scope and key name a preference, not a person",
    },
  },
} as const satisfies PolicyMap;
