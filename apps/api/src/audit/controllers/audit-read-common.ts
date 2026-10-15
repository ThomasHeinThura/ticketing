import type { Context } from "hono";
import db from "../../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../../instance/observability/runtime";
import { appendAuditLog } from "../audit-writer";

export type { AuditQuery } from "../repository";

/**
 * AU-13: every read of the log is itself audited — one `audit.read` row, no batching,
 * no sampling (the spec's own volume decision, audit-trail.md § Access). AU-14: a
 * failed write never fails the read; it logs at error level (the metric and
 * notification hooks land with the observability slice). `audit.read` is in
 * `actions.ts`'s catalogue (line 86), so `validateAction` accepts it.
 */
export async function writeAuditRead(
  c: Context,
  scope: { readonly workspaceId: string | null },
): Promise<void> {
  try {
    const userId = c.get("userId") as string | undefined;
    await appendAuditLog(db, {
      actorId: userId ?? null,
      actorType: "person",
      workspaceId: scope.workspaceId,
      action: "audit.read",
      entityType: "audit_log",
      entityId: scope.workspaceId ?? "instance",
    });
  } catch {
    recordAuditWriteFailure("audit_read");
    await notifyCurrentInstanceAdminsOfAuditFailure("audit_read");
  }
}
