import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Cycles, modules and estimates (feature-contracts-p5.md, "Cycles, modules and estimates").
 * Seeing is `project:read`; creating, editing, completing, deleting and configuring estimates is
 * `project:manage_settings`; adding or removing items and setting an estimate on an item is
 * `work_item:update`. Every route resolves reach to the project first: an unreachable project, a
 * foreign cycle or a foreign module answers 404. A customer never reaches these routes (the
 * handler refuses a non-staff caller). A flag-off project answers 404 `feature_disabled`.
 *
 * `/projects/{key}/...` routes name the project by its key (slug) or id; `/cycles/{id}` and
 * `/modules/{id}` resolve the project from the row.
 */
const read = {
  capability: "project:read",
  scope: "project",
  scopeSource: "row",
  reach: "required",
} as const;
const manage = {
  capability: "project:manage_settings",
  scope: "project",
  scopeSource: "row",
  reach: "required",
} as const;
const editItems = {
  capability: "work_item:update",
  scope: "project",
  scopeSource: "row",
  reach: "required",
} as const;
const editWorkItem = {
  capability: "work_item:update",
  scope: "work_item",
  scopeSource: "row",
  reach: "required",
} as const;

export const agilePolicies = {
  "GET /api/projects/{key}/cycles": read,
  "POST /api/projects/{key}/cycles": manage,
  "GET /api/cycles/{id}": read,
  "PATCH /api/cycles/{id}": manage,
  "DELETE /api/cycles/{id}": manage,
  "POST /api/cycles/{id}/complete": manage,
  "POST /api/cycles/{id}/work-items": editItems,
  "DELETE /api/cycles/{id}/work-items/{workItemKey}": editItems,
  "GET /api/cycles/{id}/burndown": read,
  "GET /api/projects/{key}/modules": read,
  "POST /api/projects/{key}/modules": manage,
  "GET /api/modules/{id}": read,
  "PATCH /api/modules/{id}": manage,
  "DELETE /api/modules/{id}": manage,
  "POST /api/modules/{id}/work-items": editItems,
  "DELETE /api/modules/{id}/work-items/{workItemKey}": editItems,
  "GET /api/projects/{key}/estimates": read,
  "PATCH /api/projects/{key}/estimates": manage,
  "GET /api/projects/{key}/agile-settings": read,
  "PATCH /api/projects/{key}/agile-settings": manage,
  "GET /api/projects/{key}/dependencies": {
    capability: "work_item:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/projects/{key}/wip-limits": read,
  "PUT /api/projects/{key}/wip-limits/{stateId}": manage,
  "GET /api/work-items/{key}/estimate": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "PUT /api/work-items/{key}/estimate": editWorkItem,
  "PUT /api/work-items/{key}/cycle": editWorkItem,
  "PUT /api/work-items/{key}/module": editWorkItem,
} as const satisfies PolicyMap;
