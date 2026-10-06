import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Approval route declarations from `approvals.md` § Permissions. Runtime handlers
 * additionally enforce named-approver, CAB-team and addressed-portal predicates.
 */
export const approvalPolicies = {
  "GET /api/work-items/{key}/approvals": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/work-items/{key}/approvals": {
    capability: "approval:request",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/approvals/{id}/decide": {
    capability: "approval:decide",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/approvals/{id}/withdraw": {
    capability: "approval:request",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/me/approvals": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason: "lists approval rows addressed to the authenticated person",
    },
  },
  "GET /api/portal/approvals": {
    portal: "customer",
    predicate: "addressed_approval",
  },
  "POST /api/portal/approvals/{id}/decide": {
    portal: "customer",
    predicate: "addressed_approval",
  },
} as const satisfies PolicyMap;
