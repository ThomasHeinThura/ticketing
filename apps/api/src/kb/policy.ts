import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Knowledge base routes (feature-contracts-p5.md, "Knowledge base"). The contract lists the
 * thirteen core routes; the others (submit, unpublish, archive, version read and restore,
 * feedback list, report, settings, category writes, portal categories and the portal deflection
 * recording) take the capability the contract's permission table assigns to the action. Portal
 * routes are `own_organisation` (kind 3) and share one visibility condition. The agent and the
 * portal deflection routes are two routes over separate domain functions (ADR 0004), never one
 * route serving either session.
 */
export const kbPolicies = {
  "GET /api/kb/articles": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/kb/articles": {
    capability: "kb_article:write",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/kb/articles/{id}": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "PATCH /api/kb/articles/{id}": {
    capability: "kb_article:write",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/kb/articles/{id}/submit": {
    capability: "kb_article:write",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/kb/articles/{id}/publish": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/kb/articles/{id}/unpublish": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/kb/articles/{id}/restore": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/kb/articles/{id}/archive": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/kb/articles/{id}/versions": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/kb/articles/{id}/versions/{number}": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "POST /api/kb/articles/{id}/versions/{number}/restore": {
    capability: "kb_article:write",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/kb/articles/{id}/feedback": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/kb/search": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/kb/deflection": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/kb/report": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/kb/settings": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/kb/settings": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "GET /api/kb/categories": {
    capability: "kb_article:read",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "POST /api/kb/categories": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  "PATCH /api/kb/categories/{id}": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "DELETE /api/kb/categories/{id}": {
    capability: "kb_article:publish",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/portal/kb": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/kb/categories": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/kb/deflection": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "POST /api/portal/kb/deflection": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "POST /api/portal/kb/deflection/{id}/abandon": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/kb/{id}": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "POST /api/portal/kb/{id}/feedback": {
    portal: "customer",
    predicate: "own_organisation",
  },
} as const satisfies PolicyMap;
