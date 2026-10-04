import type { PolicyMap } from "@taskdesk/permissions";

export const featureFlagPolicies = {
  "GET /api/workspaces/{workspaceId}/features": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/workspaces/{workspaceId}/features/{featureKey}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/projects/{projectId}/features": {
    capability: "project:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/projects/{projectId}/features/{featureKey}": {
    capability: "project:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/features/resolved": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
} as const satisfies PolicyMap;
