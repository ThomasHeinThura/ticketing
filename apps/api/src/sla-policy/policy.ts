import type { PolicyMap } from "@taskdesk/permissions";

export const slaPolicyPolicies = {
  "GET /api/sla-policies": {
    capability: "sla_policy:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/sla-policies": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/sla-policies/{id}": {
    capability: "sla_policy:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/sla-policies/{id}": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/sla-policies/{id}/publish": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
