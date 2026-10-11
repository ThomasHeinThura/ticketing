import type { PolicyMap } from "@taskdesk/permissions";

export const intakePolicies = {
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
} as const satisfies PolicyMap;
