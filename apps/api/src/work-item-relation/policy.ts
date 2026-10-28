import type { PolicyMap } from "@taskdesk/permissions";
export const workItemRelationPolicies = {
  "GET /api/work-items/{key}/relation-candidates": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/work-items/{key}/relations": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/work-items/{key}/relations": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/work-items/{key}/relations/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} satisfies PolicyMap;
