import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Workspace webhooks (`feature-contracts-p4.md` "Webhooks and API keys", `WH-1`..`WH-15`).
 *
 * `webhook:manage` is in `AUTHORITY_GRANTING`, so every route here either declares
 * `elevated: true` (with `sessionOnly: true`, which the elevation coverage test requires) or an
 * explicit `elevated: false` with a reason. `POST /api/webhooks`, `PATCH /api/webhooks/{id}` and
 * `POST /api/webhooks/{id}/rotate-secret` are on rbac.md's single elevated list, so they declare
 * `elevated: true`. PATCH is documented as elevated only when the body changes `url`; a policy
 * cannot be conditional, so the whole route is session-only (an API key cannot edit a webhook).
 *
 * The workspace comes from the `X-Workspace-Id` header (`scopeSource: "request"`).
 *
 * `DELETE /api/webhooks/{id}` only requests a deletion: it opens a typed-name + step-up pending
 * action (AK-11, `PA-5`) whose target is `webhookDeletionTarget` in `deletion-target.ts`, so it is
 * elevated and session-only like the other routes that outlive a request.
 */
export const webhookPolicies = {
  "GET /api/webhooks": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "read-only list; the signing secret is write-only and is never returned",
  },
  "POST /api/webhooks": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "PATCH /api/webhooks/{id}": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "DELETE /api/webhooks/{id}": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "POST /api/webhooks/{id}/test": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "sends one synthetic, entity-free event to the already-configured destination; no workspace data leaves",
  },
  "POST /api/webhooks/{id}/rotate-secret": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: true,
    sessionOnly: true,
  },
  "GET /api/webhooks/{id}/deliveries": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "read-only history; payload bodies are redacted per row unless the entity is in the reader's reach (WH-6)",
  },
  "POST /api/webhooks/deliveries/{id}/redeliver": {
    capability: "webhook:manage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
    elevated: false,
    elevationExemptionReason:
      "re-sends an already-recorded body to the already-configured destination, re-checked against the owner's current reach (WH-14)",
  },
} as const satisfies PolicyMap;
