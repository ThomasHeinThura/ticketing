import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Report and dashboard routes (feature-contracts-p5.md, "Reports and dashboards").
 *
 * Every route is workspace-scoped and staff-only: the handler chain starts with a staff gate, so a
 * customer session is refused with 403 on every one of them (RP-18). Project reach is applied by
 * every query (RP-17), so the policy scope stays `workspace`, like the other P5 modules.
 *
 * - `report:read` is the floor; `report:read_all` widens the numbers to every project of the
 *   workspace, checked in the handler because it changes the data, not the access.
 * - The dashboard routes declare `report:read`: a personal dashboard is the caller's own, and a
 *   workspace dashboard additionally needs `workspace:manage_settings` to change (RP-14), which
 *   the handler enforces because the policy vocabulary has no scope-dependent capability.
 * - Rate and cost data appear only with `time_entry:manage_rates` (TC-11), on every route.
 */
export const reportPolicies = {
  "GET /api/reports": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/reports/{key}": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/reports/{key}/items": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/reports/{key}/export": {
    capability: "report:export",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/reports/custom/export": {
    capability: "report:export",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/reports/custom/items": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/report-exports": {
    capability: "report:export",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/report-exports/{id}": {
    capability: "report:export",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/report-exports/{id}/download": {
    capability: "report:export",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/reports/custom/preview": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/dashboards": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/dashboards": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/dashboards/{id}": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/dashboards/{id}": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/dashboards/{id}": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/dashboards/{id}/widgets/{wid}/data": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/dashboards/{id}/widgets/{wid}/items": {
    capability: "report:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/dashboards/{id}/widgets/{wid}/export": {
    capability: "report:export",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
