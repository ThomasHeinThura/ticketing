import type { StepUpOperation } from "./step-up-audit";

/**
 * How every route declared `elevated: true` in a policy map actually enforces fresh
 * authentication. `elevated` is a declaration, so a route that sets it without spending a
 * step-up proof would claim a control that runs nowhere (the gap the P4 audit found for role
 * create/update, service-key create and ownership transfer). `pnpm test:permissions`
 * (`tests/permissions/elevated-enforcement.test.ts`) requires exactly one classification here for
 * each `elevated: true` route, checks that the named handler file really contains the named
 * consumer, and that every operation key is in the PA-15 allowlist and the database CHECK.
 *
 * - `operation`: the handler spends a one-use, route-bound PA-15 proof for `operation`.
 * - `conditional_operation`: the same, but only when `when` holds (the route is elevated only
 *   for that change, per permissions.md).
 * - `pending_action`: the route only requests a deletion; the proof is spent when the requester
 *   approves it, because the target's confirmation is `typed_name_step_up`.
 * - `pending_action_approval`: the approval route itself spends the proof for those targets.
 * - `exempt`: a contract-reasoned exemption. Adding one needs the contract text that allows it.
 */
export type ElevatedEnforcement =
  | {
      kind: "operation";
      operation: StepUpOperation;
      /** Path under `apps/api/src` of the file that spends the proof. */
      handler: string;
      /** Identifier that must appear in `handler` (the consume call). */
      consumer: string;
    }
  | {
      kind: "conditional_operation";
      operation: StepUpOperation;
      handler: string;
      consumer: string;
      when: string;
    }
  | { kind: "pending_action"; handler: string; confirmation: string }
  | { kind: "pending_action_approval"; handler: string; consumer: string }
  | { kind: "exempt"; reason: string };

export const ELEVATED_ENFORCEMENT: Record<string, ElevatedEnforcement> = {
  // Workspace and keys
  "POST /api/workspace/{workspaceId}/roles": {
    kind: "operation",
    operation: "workspace_role_create",
    handler: "workspace/index.ts",
    consumer: "runWithStepUp",
  },
  "PATCH /api/workspace/{workspaceId}/roles/{roleId}": {
    kind: "operation",
    operation: "workspace_role_update",
    handler: "workspace/index.ts",
    consumer: "runWithStepUp",
  },
  "DELETE /api/workspace/{workspaceId}/roles/{roleId}": {
    kind: "exempt",
    reason:
      "RL-8: role deletion is a click-level pending action approved by the requester after every holder is reassigned (feature-contracts-p4.md); permissions.md lists role deletion as elevated, so this is flagged for an owner decision rather than silently upgraded",
  },
  "POST /api/workspace/{workspaceId}/transfer-ownership": {
    kind: "operation",
    operation: "workspace_ownership_transfer",
    handler: "workspace/index.ts",
    consumer: "runWithStepUp",
  },
  "POST /api/workspaces/{id}/api-keys": {
    kind: "operation",
    operation: "service_key_create",
    handler: "api-key/index.ts",
    consumer: "runWithStepUp",
  },
  "DELETE /api/workspaces/{id}/api-keys/{keyId}": {
    kind: "pending_action",
    handler: "api-key/service-key-deletion-target.ts",
    confirmation: "typed_name_step_up",
  },
  // Webhooks
  "POST /api/webhooks": {
    kind: "operation",
    operation: "webhook_create",
    handler: "webhook/index.ts",
    consumer: "runWithStepUp",
  },
  "PATCH /api/webhooks/{id}": {
    kind: "conditional_operation",
    operation: "webhook_update_url",
    handler: "webhook/index.ts",
    consumer: "runWithStepUp",
    when: "the body changes url",
  },
  "POST /api/webhooks/{id}/rotate-secret": {
    kind: "operation",
    operation: "webhook_rotate_secret",
    handler: "webhook/index.ts",
    consumer: "runWithStepUp",
  },
  "DELETE /api/webhooks/{id}": {
    kind: "pending_action",
    handler: "webhook/deletion-target.ts",
    confirmation: "typed_name_step_up",
  },
  // Service management
  "POST /api/work-items/{key}/change/override-freeze": {
    kind: "operation",
    operation: "change_freeze_override",
    handler: "service-management/index.ts",
    consumer: "runWithStepUp",
  },
  // Pending actions
  "POST /api/me/pending-actions/{id}/approve": {
    kind: "pending_action_approval",
    handler: "pending-action/service.ts",
    consumer: "consumePendingActionProof",
  },
  // God Mode
  "POST /api/instance/users/{id}/impersonate": {
    kind: "operation",
    operation: "impersonation_start",
    handler: "instance/impersonation/index.ts",
    consumer: "runWithStepUp",
  },
  "POST /api/instance/plugins/rotate-secrets": {
    kind: "operation",
    operation: "secrets_rotate",
    handler: "instance/secrets/rotate-secrets.ts",
    consumer: "runWithStepUp",
  },
  "POST /api/instance/users/{id}/grant-admin": {
    kind: "operation",
    operation: "instance_admin_grant",
    handler: "instance/users/index.ts",
    consumer: "consumeInstanceAdminGrantProof",
  },
  "POST /api/instance/users/{id}/reset-mfa": {
    kind: "operation",
    operation: "mfa_reset",
    handler: "instance/reset-mfa.ts",
    consumer: "consumeMfaResetProof",
  },
  "POST /api/instance/observability/metrics-token/rotate": {
    kind: "operation",
    operation: "metrics_token_rotate",
    handler: "instance/observability/metrics-token-rotation.ts",
    consumer: "consumeRotationProof",
  },
  "POST /api/instance/identity-connections": {
    kind: "operation",
    operation: "identity_connection_create",
    handler: "identity/connection-admin.ts",
    consumer: "consumeIdentityConnectionProof",
  },
  "PATCH /api/instance/identity-connections/{id}": {
    kind: "operation",
    operation: "identity_connection_configure",
    handler: "identity/connection-admin.ts",
    consumer: "consumeIdentityConnectionProof",
  },
  "POST /api/instance/identity-connections/{id}/oidc-group-mappings": {
    kind: "operation",
    operation: "oidc_group_mapping_create",
    handler: "identity/oidc-group-mapping-admin.ts",
    consumer: "consumeOidcGroupMappingProof",
  },
  "PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}":
    {
      kind: "operation",
      operation: "oidc_group_mapping_update",
      handler: "identity/oidc-group-mapping-admin.ts",
      consumer: "consumeOidcGroupMappingProof",
    },
  "PATCH /api/instance/identity-connections/{id}/scim": {
    kind: "operation",
    operation: "scim_admin_update",
    handler: "identity/scim-admin.ts",
    consumer: "consumeScimAdminProof",
  },
  "POST /api/instance/identity-connections/{id}/scim/rotate-token": {
    kind: "operation",
    operation: "scim_token_rotate",
    handler: "identity/scim-admin.ts",
    consumer: "consumeScimTokenProof",
  },
  "POST /api/instance/identity-connections/{id}/scim/revoke-token": {
    kind: "operation",
    operation: "scim_token_revoke",
    handler: "identity/scim-admin.ts",
    consumer: "consumeScimTokenProof",
  },
};
