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
  // `P2R1-18`: a click-level pending action (PA-1), refused while published or used.
  "DELETE /api/request-types/{id}": {
    capability: "request_type:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/portal/catalogue": {
    portal: "customer",
    predicate: "own_organisation",
  },
  // S4b. The contract lists `GET /api/portal/me` as `self`, which is not a `PortalPredicate`;
  // it is served under the customer's own organisation and reads only the caller's own row.
  "GET /api/portal/me": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/home": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/requests": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/requests/export.csv": {
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
  // U-12 (D6): a request raised by staff. Reach is the case list's row (requester, participant,
  // organisation-visible colleague); reply and files are the requester's only (CP-16).
  "GET /api/portal/requests/{ref}": {
    portal: "customer",
    predicate: "own_request",
  },
  "POST /api/portal/requests/{ref}/comments": {
    portal: "customer",
    predicate: "own_request",
  },
  "GET /api/portal/requests/{ref}/attachments": {
    portal: "customer",
    predicate: "own_request",
  },
  "POST /api/portal/requests/{ref}/attachments/presign": {
    portal: "customer",
    predicate: "own_request",
  },
  "POST /api/portal/requests/{ref}/attachments/{id}/complete": {
    portal: "customer",
    predicate: "own_request",
  },
  "GET /api/portal/requests/{ref}/attachments/{id}": {
    portal: "customer",
    predicate: "own_request",
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
