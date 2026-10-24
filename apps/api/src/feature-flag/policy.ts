import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Feature-flag administration (settings-hierarchy.md `ST-1`, `ST-2`; god-mode.md Features).
 * Flags cross levels: instance (lockable) -> workspace -> project. A write below a locked
 * instance flag answers 409. The resolved read is open to any authenticated session for its
 * own reach.
 */
export const featureFlagPolicies = {
  "GET /api/instance/features": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: { exempt: "no_single_resource", reason: "instance-wide flags" },
    elevated: false,
    elevationExemptionReason: "read-only list of feature switches",
  },
  "PATCH /api/instance/features": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: { exempt: "no_single_resource", reason: "instance-wide flags" },
    elevated: false,
    elevationExemptionReason:
      "feature switches change availability only; they grant no authority and are audited per flag",
  },
  "GET /api/workspaces/{workspaceId}/features": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/workspaces/{workspaceId}/features": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/projects/{projectId}/features": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/projects/{projectId}/features": {
    capability: "project:manage_settings",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/features/resolved": {
    capability: "project:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
