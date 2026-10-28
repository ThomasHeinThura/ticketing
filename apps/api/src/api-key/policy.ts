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
 * Personal-key deletion is a session-only self route (`AK-11`). The registered target binds
 * the key row's persisted person id to this same human; personal MCP keys follow the same rule.
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
  "DELETE /api/me/api-keys/{id}": {
    authenticated: true,
    self: true,
    personParam: selfNoPersonParam,
    elevated: true,
    sessionOnly: true,
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
  // AK-7: God Mode's key list, so a durable credential with no live owner is visible.
  "GET /api/instance/api-keys": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "instance-wide credential inventory",
    },
    elevated: false,
    elevationExemptionReason:
      "read-only inventory: never returns a key or its hash, mints no authority",
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
  "POST /api/workspaces/{id}/api-keys/{keyId}/re-attest": {
    capability: "api_key:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
