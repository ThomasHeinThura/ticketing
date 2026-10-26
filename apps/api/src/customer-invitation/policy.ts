import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Customer invitations (feature-contracts-p3.md CP-20..CP-26). Agent routes: `member:invite`,
 * workspace scope, browser session only (CP-20: never an API key or MCP key). The organisation
 * is named in the path; it must be a live customer organisation or the route answers 404. Revoke
 * is the existing `DELETE /api/invitation/{id}` (same capability, same pending-action flow).
 *
 * The accept route is a customer-portal route (kind 3, `own_organisation`): it needs an admitted
 * customer session and the handler requires the invitation to name that customer's own
 * organisation; every refusal is the same 404.
 */
const manage = {
  capability: "member:invite",
  scope: "workspace",
  scopeSource: "request",
  reach: "required",
  sessionOnly: true,
} as const;

export const customerInvitationPolicies = {
  "GET /api/portal/auth-methods": {
    public: true,
    reason:
      "customer-host-only enabled local sign-in flags; no invitation or organisation state",
  },
  "POST /api/portal/invitations/{id}/continuation": {
    public: true,
    reason:
      "customer-host-only, anonymous-rate-limited invitation credential handoff; stores only nonce and credential hashes",
  },
  "GET /api/portal/invitations/{id}/continuation-result": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "POST /api/portal/invitations/{id}/accept-continuation": {
    portal: "customer",
    predicate: "own_organisation",
  },

  "GET /api/workspace/{workspaceId}/customer-organisations": manage,
  "GET /api/workspace/{workspaceId}/organisations/{organisationId}/invitations":
    manage,
  "POST /api/workspace/{workspaceId}/organisations/{organisationId}/invitations":
    manage,
  "POST /api/workspace/{workspaceId}/organisations/{organisationId}/invitations/{id}/resend":
    manage,
  "POST /api/portal/invitations/{id}/accept": {
    portal: "customer",
    predicate: "own_organisation",
  },
} as const satisfies PolicyMap;
