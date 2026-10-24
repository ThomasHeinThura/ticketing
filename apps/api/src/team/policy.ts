import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Team routes (feature-contracts-p4.md, "Teams"). Roster edits are `workspace:manage_settings`;
 * a lead of the team may also edit that team's roster (TM-3), enforced in the handler because the
 * closed `orOwner` predicate vocabulary has no `row.is_lead` entry yet.
 */
export const teamPolicies = {
  "GET /api/teams": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/teams": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/teams/{id}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/teams/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/teams/{id}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/teams/{id}/members": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/teams/{id}/members/{personId}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/teams/{id}/members/{personId}": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
