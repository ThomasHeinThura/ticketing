import type { PolicyMap } from "@taskdesk/permissions";

export const serviceCalendarPolicies = {
  "GET /api/service-calendars": {
    capability: "sla_policy:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/service-calendars": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/service-calendars/{id}": {
    capability: "sla_policy:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/service-calendars/{id}": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/service-calendars/{id}/holidays/import": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/service-calendars/{id}/preview": {
    capability: "sla_policy:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/service-calendars/{id}/usage": {
    capability: "sla_policy:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/service-calendars/{id}": {
    capability: "sla_policy:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
