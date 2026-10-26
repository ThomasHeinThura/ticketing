import type { PolicyMap } from "@taskdesk/permissions";

export const intakePolicies = {
  "GET /api/intake/queues": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/intake/queues": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/intake/queues/{id}": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/intake/queues/{id}": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/intake/queues/{id}/run": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/request-type-groups/order": {
    capability: "request_type:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PUT /api/request-type-groups/order": {
    capability: "request_type:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/request-types": {
    capability: "request_type:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/request-types": {
    capability: "request_type:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/request-types/{id}": {
    capability: "request_type:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/request-types/{id}": {
    capability: "request_type:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/request-types/{id}/publish": {
    capability: "request_type:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/request-types/{id}/unpublish": {
    capability: "request_type:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/portal/catalogue": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/requests/backlog": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "POST /api/portal/requests/rank": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/catalogue/{key}": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "POST /api/portal/submissions": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/submissions": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/submissions/{ref}": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/submissions/{ref}/claim": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/submissions/{ref}/accept": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/submissions/{ref}/decline": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/submissions/{ref}/duplicate": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/submissions/{ref}/messages": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/submissions/{ref}/duplicates": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/portal/submissions": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/submissions/{ref}": {
    portal: "customer",
    predicate: "own_submission",
  },
  "POST /api/portal/submissions/{ref}/messages": {
    portal: "customer",
    predicate: "own_submission",
  },
  "POST /api/portal/submissions/{ref}/withdraw": {
    portal: "customer",
    predicate: "own_submission",
  },
  // CP-7 / CP-8 / CP-9. The contract table lists these as `own_request` on /requests/{ref}/...;
  // they are served on the submission's durable URL (CP-10), so the submission predicate applies.
  "POST /api/portal/submissions/{ref}/escalate-priority": {
    portal: "customer",
    predicate: "own_submission",
  },
  "POST /api/portal/submissions/{ref}/reopen": {
    portal: "customer",
    predicate: "own_submission",
  },
  "POST /api/portal/submissions/{ref}/satisfaction": {
    portal: "customer",
    predicate: "own_submission",
  },
} as const satisfies PolicyMap;
