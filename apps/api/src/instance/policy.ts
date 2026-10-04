import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Instance-surface route policies.
 *
 * Every route under `/api/instance/*` is caught by the elevation rule: it must declare
 * `elevated: true`, or `elevated: false` with a written reason. A new authority-minting route
 * that nobody remembered to list therefore fails the build instead of shipping unprotected
 * (`docs/01-architecture/rbac.md`, elevation coverage test).
 */
export const instancePolicies = {
  "GET /api/instance/identity-connections": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "identity connection inventory is an instance-wide admin view",
    },
    elevated: false,
    elevationExemptionReason:
      "safe identity DTO omits client secrets and raw provider claims",
  },
  "GET /api/instance/organisations/{id}/identity": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "identity settings are administered only by instance administrators",
    },
    elevated: false,
    elevationExemptionReason:
      "safe identity DTO omits client secrets and raw provider claims",
  },
  "POST /api/instance/identity-connections": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "identity connection creation is an instance-wide operation",
    },
    elevated: true,
    sessionOnly: true,
  },
  "PATCH /api/instance/identity-connections/{id}": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "identity connection configuration is an instance-wide operation",
    },
    elevated: true,
    sessionOnly: true,
  },
  "GET /api/instance/identity-connections/{id}/scim": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "safe SCIM configuration read has no tenant resource",
    },
    elevated: false,
    elevationExemptionReason:
      "read-only SCIM settings omit token material and identity payloads",
  },
  "GET /api/instance/identity-connections/{id}/scim/mapping-options": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "connection-bound selector options are instance identity metadata",
    },
    elevated: false,
    sessionOnly: true,
    elevationExemptionReason:
      "read-only eligible target and role metadata contains no credentials or grants",
  },
  "PATCH /api/instance/identity-connections/{id}/scim": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "SCIM administration is an instance-wide identity operation",
    },
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/instance/identity-connections/{id}/scim/rotate-token": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "SCIM token rotation changes instance identity authority",
    },
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/instance/identity-connections/{id}/scim/revoke-token": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "SCIM token revocation changes instance identity authority",
    },
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/instance/users/{id}/reset-mfa": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "MFA reset is an instance-wide identity recovery operation",
    },
    elevated: true,
    sessionOnly: true,
  },
  "GET /api/instance/local-factor-policy": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "instance-wide MFA policy has no tenant resource",
    },
    elevated: false,
    elevationExemptionReason: "read-only current instance MFA policy",
  },
  "PATCH /api/instance/local-factor-policy": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "instance-wide MFA policy has no tenant resource",
    },
    elevated: false,
    elevationExemptionReason:
      "validates and audits the instance MFA policy; required users are then gated at every protected API",
  },
  // Public liveness probe for the auth surface, registered above the authentication
  // middleware, and declared here so that "public" is a stated, reviewable act rather than a
  // consequence of line ordering. #8 re-confirms this against the retained surface, and the
  // P0 security review reads every public reason.
  //
  // #18 closed the finding this route used to enable: it served `{ hasUsers, hasAdmin }`
  // computed live from the user table, unauthenticated, which let anyone scan for an
  // unclaimed instance and race its operator to become admin
  // (docs/07-planning/security-reviews/13-kaneo-import-lenses/E-secrets.md, finding E-13).
  // It now returns a constant `{ status: "ok" }` that carries no information about whether
  // the instance has been claimed — first-run setup is reached through the one-time setup
  // URL and token printed to the container log (auth-and-identity.md § Break-glass), never
  // discovered from this route.
  "GET /api/instance/status": {
    public: true,
    reason:
      "public liveness probe for the auth surface; reveals no setup state",
    elevated: false,
    elevationExemptionReason:
      "returns a constant value regardless of instance state; it grants nothing, changes nothing, and no longer distinguishes claimed from unclaimed (#18)",
  },
  "GET /api/instance/observability": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "instance-wide observability configuration has no tenant resource",
    },
    elevated: false,
    elevationExemptionReason:
      "safe read-only configuration response; it does not expose the token digest or bearer",
  },
  "PATCH /api/instance/observability": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "instance-wide observability configuration has no tenant resource",
    },
    elevated: false,
    elevationExemptionReason:
      "changes only validated log levels through version compare-and-set and records an audit row",
  },
  "POST /api/instance/observability/metrics-token/rotate": {
    capability: "instance:admin",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason: "metrics-token authority belongs to the instance configuration",
    },
    elevated: true,
    sessionOnly: true,
  },
} as const satisfies PolicyMap;
