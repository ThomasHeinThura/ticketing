import { appendAuditLog } from "../audit/audit-writer";
import type db from "../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { normaliseTraceId } from "../permissions/shadow-middleware";

export type StepUpOperation =
  | "metrics_token_rotate"
  | "mfa_reset"
  | "instance_admin_grant"
  | "instance_admin_suspend"
  | "oidc_group_mapping_create"
  | "oidc_group_mapping_update"
  | "scim_admin_update"
  | "scim_token_rotate"
  | "scim_token_revoke"
  | "identity_connection_create"
  | "identity_connection_configure"
  | "impersonation_start"
  | "secrets_rotate"
  | "organisation_restore"
  | "webhook_create"
  | "webhook_update_url"
  | "webhook_rotate_secret"
  | "webhook_rotate_all"
  | "workspace_role_create"
  | "workspace_role_update"
  | "service_key_create"
  | "service_key_reattest"
  | "workspace_ownership_transfer"
  | "change_freeze_override";

export type StepUpAuditAction =
  | "auth.step_up_issued"
  | "auth.step_up_consumed"
  | "auth.step_up_denied";

type StepUpTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AuditDatabase = typeof db | StepUpTransaction;

export const STEP_UP_OPERATION_ROUTES: Record<StepUpOperation, string> = {
  metrics_token_rotate: "POST /api/instance/observability/metrics-token/rotate",
  mfa_reset: "POST /api/instance/users/{id}/reset-mfa",
  instance_admin_grant: "POST /api/instance/users/{id}/grant-admin",
  instance_admin_suspend: "POST /api/instance/users/{id}/suspend",
  oidc_group_mapping_create:
    "POST /api/instance/identity-connections/{id}/oidc-group-mappings",
  oidc_group_mapping_update:
    "PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}",
  scim_admin_update: "PATCH /api/instance/identity-connections/{id}/scim",
  scim_token_rotate:
    "POST /api/instance/identity-connections/{id}/scim/rotate-token",
  scim_token_revoke:
    "POST /api/instance/identity-connections/{id}/scim/revoke-token",
  identity_connection_create: "POST /api/instance/identity-connections",
  identity_connection_configure:
    "PATCH /api/instance/identity-connections/{id}",
  impersonation_start: "POST /api/instance/users/{id}/impersonate",
  secrets_rotate: "POST /api/instance/plugins/rotate-secrets",
  organisation_restore: "POST /api/instance/organisations/{id}/restore",
  webhook_create: "POST /api/webhooks",
  webhook_update_url: "PATCH /api/webhooks/{id}",
  webhook_rotate_secret: "POST /api/webhooks/{id}/rotate-secret",
  webhook_rotate_all: "POST /api/instance/webhooks/rotate-secrets",
  workspace_role_create: "POST /api/workspace/{workspaceId}/roles",
  workspace_role_update: "PATCH /api/workspace/{workspaceId}/roles/{roleId}",
  service_key_create: "POST /api/workspaces/{id}/api-keys",
  service_key_reattest: "POST /api/workspaces/{id}/api-keys/{keyId}/re-attest",
  workspace_ownership_transfer:
    "POST /api/workspace/{workspaceId}/transfer-ownership",
  change_freeze_override: "POST /api/work-items/{key}/change/override-freeze",
};

/**
 * Write only the fixed binding metadata allowed by the audit-trail step-up contract.
 * A nested audit savepoint preserves AU-14: failure never rolls back the operation,
 * but is counted, safely logged, and durably notified to current instance admins.
 */
export async function appendStepUpAudit(
  database: AuditDatabase,
  input: {
    action: StepUpAuditAction;
    actorId: string;
    personId: string;
    operation: StepUpOperation;
    traceId?: string | null;
  },
): Promise<void> {
  try {
    await appendAuditLog(database, {
      action: input.action,
      actorId: input.actorId,
      actorType: "person",
      traceId: normaliseTraceId(input.traceId ?? undefined),
      workspaceId: null,
      entityType: "person",
      entityId: input.personId,
      after: {
        bindingKind: "operation",
        operation: input.operation,
        route: STEP_UP_OPERATION_ROUTES[input.operation],
      },
    });
  } catch {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
}

export async function appendPendingActionStepUpAudit(
  database: AuditDatabase,
  input: {
    action: StepUpAuditAction;
    actorId: string;
    personId: string;
    pendingActionId: string;
    traceId?: string | null;
  },
): Promise<void> {
  try {
    await appendAuditLog(database, {
      action: input.action,
      actorId: input.actorId,
      actorType: "person",
      traceId: normaliseTraceId(input.traceId ?? undefined),
      workspaceId: null,
      entityType: "pending_action",
      entityId: input.pendingActionId,
      after: {
        bindingKind: "pending_action",
        pendingActionId: input.pendingActionId,
      },
    });
  } catch {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
}
