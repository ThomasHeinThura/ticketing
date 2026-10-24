import type { PolicyMap } from "@taskdesk/permissions";

/**
 * API-key route policies (feature-contracts-p4.md, "Webhooks and API keys" § API; `AK-1`,
 * `AK-7`, `AK-11`, `PA-5`).
 *
 * Personal-key routes are `authenticated + self`: they only ever touch the caller's own keys.
 * Creating one is session-only (`AK-9`: a self-row mutation without a registered key
 * capability needs a browser session, and a read-only key must not be able to mint a wider
 * one). Revoking is not: killing your own credential is the safe direction (`PA-1`).
 *
 * Workspace service-key routes carry `api_key:manage`, which the elevation rule treats as
 * authority-granting, so every route declares `elevated`. Creation and deletion are elevated
 * and session-only. Listing and revoking mint no authority and say so.
 *
 * `DELETE /api/me/api-keys/{id}` (personal key deletion, `AK-11`) is NOT registered: the
 * registered-deletion mechanism only supports capability policies scoped to a workspace or
 * project, and a personal key has neither. See the P4 handback, "decisions needed".
 */
const selfNoPersonParam = {
  exempt: "no_person_parameter",
  reason: "acts only on the authenticated person's own API keys",
} as const;

export const apiKeyPolicies = {
  "GET /api/me/api-keys": {
    authenticated: true,
    self: true,
    personParam: selfNoPersonParam,
  },
  "POST /api/me/api-keys": {
    authenticated: true,
    self: true,
    personParam: selfNoPersonParam,
    sessionOnly: true,
  },
  "POST /api/me/api-keys/{id}/revoke": {
    authenticated: true,
    self: true,
    personParam: selfNoPersonParam,
  },
  "GET /api/workspaces/{id}/api-keys": {
    capability: "api_key:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "lists key metadata only (never the key itself); it mints no authority and changes no state",
  },
  "POST /api/workspaces/{id}/api-keys": {
    capability: "api_key:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "DELETE /api/workspaces/{id}/api-keys/{keyId}": {
    capability: "api_key:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/workspaces/{id}/api-keys/{keyId}/revoke": {
    capability: "api_key:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "revocation only removes authority from a credential; the row stays for audit (AK-6)",
  },
} as const satisfies PolicyMap;
