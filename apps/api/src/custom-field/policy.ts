import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Custom field routes (feature-contracts-p4.md, "Custom fields"). Reads need `workspace:read`;
 * every write, including sections and reorders, is `custom_field:manage`.
 */
export const customFieldPolicies = {
  "GET /api/custom-fields": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/custom-fields": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/custom-fields/{id}": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/custom-fields/{id}": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/custom-fields/{id}/restore": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PUT /api/custom-fields/{id}/visibility": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/custom-fields/{id}/non-compliant-items": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/custom-fields/reorder": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/custom-field-sections": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/custom-field-sections": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/custom-field-sections/{id}": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/custom-field-sections/{id}": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/custom-field-sections/reorder": {
    capability: "custom_field:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
} as const satisfies PolicyMap;
