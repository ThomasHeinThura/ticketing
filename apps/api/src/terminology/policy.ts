import type { PolicyMap } from "@taskdesk/permissions";

export const terminologyPolicies = {
  "GET /api/public/terminology": {
    public: true,
    reason:
      "returns only shipped terminology plus instance overrides for this app host's audience",
  },
  "GET /api/instance/terminology": {
    capability: "instance:manage_terminology",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "lists instance-wide terminology settings",
    },
    elevated: false,
    elevationExemptionReason:
      "read-only terminology settings; no authority is minted",
  },
  "PUT /api/instance/terminology": {
    capability: "instance:manage_terminology",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "updates instance-wide terminology settings",
    },
    elevated: false,
    elevationExemptionReason:
      "terminology changes affect visible nouns only and are audited",
    sessionOnly: true,
  },
  "POST /api/instance/terminology/preview": {
    capability: "instance:manage_terminology",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "previews instance terminology settings",
    },
    elevated: false,
    elevationExemptionReason: "preview does not persist or mint authority",
    sessionOnly: true,
  },
  "GET /api/workspaces/{workspaceId}/terminology": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/workspaces/{workspaceId}/terminology/runtime": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PUT /api/workspaces/{workspaceId}/terminology": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/portal/terminology": {
    portal: "customer",
    predicate: "own_organisation",
  },
} as const satisfies PolicyMap;
