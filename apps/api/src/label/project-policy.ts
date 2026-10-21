import type { PolicyMap } from "@taskdesk/permissions";

export const projectLabelPolicies = {
  "GET /api/label/project/{projectId}/catalogue": {
    capability: "workspace:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/label/project/{projectId}/catalogue": {
    capability: "label:manage",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/label/project/{projectId}/catalogue/{id}": {
    capability: "label:manage",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/label/project/{projectId}/catalogue/{id}": {
    capability: "label:manage",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
