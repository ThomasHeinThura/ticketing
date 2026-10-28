import type { JsonValue } from "@taskdesk/domain";
import type { Context } from "hono";
import { clientIpForContext } from "../../api-key/enforce";
import db from "../../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../../instance/observability/runtime";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { type AppendAuditLogInput, appendAuditLog } from "../audit-writer";

export type { AuditQuery } from "../repository";

/**
 * AU-1/AU-4 record completeness for a request-scoped audit row: the acting identity
 * (person or API key), the impersonator when the session is impersonated, the caller's IP and
 * user agent, and a trace id. Read from the request context only; never from a body.
 */
export function requestAuditActor(
  c: Context,
): Pick<
  AppendAuditLogInput,
  | "actorId"
  | "actorType"
  | "apiKeyId"
  | "impersonatorId"
  | "actorIp"
  | "userAgent"
  | "traceId"
> {
  const userId = c.get("userId") as string | undefined;
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  return {
    actorId: userId ?? null,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
    impersonatorId: session?.impersonatedBy ?? null,
    actorIp: clientIpForContext(c),
    userAgent: c.req.header("user-agent") ?? null,
    traceId: normaliseTraceId(c.req.header("x-request-id")),
  };
}

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
    await appendAuditLog(db, {
      ...requestAuditActor(c),
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

/**
 * AU-13: exporting the log is itself audited as `audit.exported`. Records the closed
 * filter set, the format and the row count only; never any exported row content. Returns
 * whether the audit write succeeded so the caller can decide (AU-14: a failed audit write
 * never fails the export, but is never silent).
 */
export async function writeAuditExport(
  c: Context,
  summary: Readonly<Record<string, JsonValue>>,
): Promise<void> {
  try {
    await appendAuditLog(db, {
      ...requestAuditActor(c),
      workspaceId: null,
      action: "audit.exported",
      entityType: "audit_log",
      entityId: "instance",
      after: { ...summary },
    });
  } catch {
    recordAuditWriteFailure("audit_read");
    await notifyCurrentInstanceAdminsOfAuditFailure("audit_read");
  }
}
