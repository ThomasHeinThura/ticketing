import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Time and cost routes (feature-contracts-p5.md, "Time and cost").
 *
 * Every route here is workspace-scoped. Project reach is applied by the repository on every
 * read and write (an entry on a project the caller cannot reach is invisible and unwritable), so
 * the policy scope stays `workspace`, like the P4 modules.
 *
 * - `GET /api/time-entries` is a collection: the contract's `orOwner(person_id, time_entry:create)`
 *   cannot be evaluated against a row, so the route declares `time_entry:create` and the handler
 *   forces `person = caller` unless the caller also holds `time_entry:read_any`.
 * - `PATCH` and `DELETE /api/time-entries/{id}` declare the contract's own/any split with
 *   `orOwner(row.person_id)`; the route middleware supplies the row's person as policy row facts.
 * - Rates are visible only with `time_entry:manage_rates` (TC-11), and every other response
 *   strips rate and cost fields unless the caller holds it.
 */
export const timeTrackingPolicies = {
  "GET /api/time-entries": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/time-entries": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/time-entries/{id}": {
    capability: "time_entry:update_any",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "time_entry:update_own",
    },
  },
  "DELETE /api/time-entries/{id}": {
    capability: "time_entry:delete_any",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "time_entry:delete_own",
    },
  },
  "GET /api/time-entries/timer": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/time-entries/timer/start": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/time-entries/timer/stop": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/time-entries/summary": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/time-settings": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/time-settings": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/time-activities": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/time-activities": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/time-activities/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/rates": {
    capability: "time_entry:manage_rates",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/rates": {
    capability: "time_entry:manage_rates",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/projects/{projectId}/budget": {
    capability: "budget:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/projects/{projectId}/budgets": {
    capability: "budget:manage",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
