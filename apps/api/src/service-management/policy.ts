import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Service catalogue, changes, freezes and releases (`feature-contracts-p5.md`
 * "Service catalogue, changes and releases"). `change:manage` is authority-granting
 * (`elevated.ts`), so each route using it either declares `elevated: true` (only the freeze
 * override does) or states why the route is not the override.
 *
 * Workspace-level routes take the workspace from the request; row routes resolve it from the
 * named row and answer a foreign row as 404. Change routes are work-item scoped, so project
 * reach is enforced exactly as for any work item.
 */
export const serviceManagementPolicies = {
  "GET /api/portal/releases": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/releases/{id}": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/service-catalogue/status": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/services": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/services": {
    capability: "service:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/services/{id}": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/services/{id}": {
    capability: "service:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/services/{id}": {
    capability: "service:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/services/{id}/status": {
    capability: "service:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/services/{id}/impact": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/changes/calendar": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/work-items/{key}/change": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/work-items/{key}/change": {
    capability: "change:manage",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "editing risk, window, rollback plan and affected services grants no authority; the freeze override is its own elevated route",
  },
  "POST /api/work-items/{key}/change/override-freeze": {
    capability: "change:manage",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/work-items/{key}/service": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/change-freezes": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/change-freezes": {
    capability: "change:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "declaring a freeze only restricts approvals; the override that bypasses one is the elevated route",
  },
  "PATCH /api/change-freezes/{id}": {
    capability: "change:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "moving or cancelling a freeze grants no authority; the override that bypasses one is the elevated route",
  },
  "GET /api/change-freezes/overrides": {
    capability: "change:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "read-only audit report of overrides already granted",
  },
  "GET /api/releases": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/releases": {
    capability: "release:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/releases/{id}": {
    capability: "project:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/releases/{id}": {
    capability: "release:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/releases/{id}/notes": {
    capability: "release:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/releases/{id}/checklist/{itemId}": {
    capability: "release:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  // CH-2 opt-in template. Workflows are workspace-level configuration, so the gate is the
  // workflow vocabulary, not change:manage; the route is a bounded workflow write, not authority
  // granting (neither workflow capability is in AUTHORITY_GRANTING).
  "GET /api/change-cab-template": {
    capability: "workflow:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/change-cab-template": {
    capability: "workflow:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
} as const satisfies PolicyMap;
