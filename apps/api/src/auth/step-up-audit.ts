import { appendAuditLog } from "../audit/audit-writer";
import type db from "../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { normaliseTraceId } from "../permissions/shadow-middleware";

export type StepUpOperation =
  | "metrics_token_rotate"
  | "mfa_reset"
  | "oidc_group_mapping_create"
  | "oidc_group_mapping_update"
  | "scim_admin_update"
  | "scim_token_rotate"
  | "scim_token_revoke";

export type StepUpAuditAction =
  | "auth.step_up_issued"
  | "auth.step_up_consumed"
  | "auth.step_up_denied";

type StepUpTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AuditDatabase = typeof db | StepUpTransaction;

const operationRoutes: Record<StepUpOperation, string> = {
  metrics_token_rotate: "POST /api/instance/observability/metrics-token/rotate",
  mfa_reset: "POST /api/instance/users/{id}/reset-mfa",
  oidc_group_mapping_create:
    "POST /api/instance/identity-connections/{id}/oidc-group-mappings",
  oidc_group_mapping_update:
    "PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}",
  scim_admin_update: "PATCH /api/instance/identity-connections/{id}/scim",
  scim_token_rotate:
    "POST /api/instance/identity-connections/{id}/scim/rotate-token",
  scim_token_revoke:
    "POST /api/instance/identity-connections/{id}/scim/revoke-token",
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
        route: operationRoutes[input.operation],
      },
    });
  } catch {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
}
