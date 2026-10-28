import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";

/** Persist a verified MCP key request without recording request-controlled data. */
export async function auditMcpRequest(input: {
  apiKeyId: string;
  ownerUserId: string;
}) {
  try {
    await appendAuditLog(db, {
      actorId: input.ownerUserId,
      actorType: "api_key",
      apiKeyId: input.apiKeyId,
      action: "mcp.request",
      entityType: "api_key",
      entityId: input.apiKeyId,
      after: { agentOriginated: true },
    });
  } catch {
    // AU-14: do not turn an audit outage into an authorization bypass or silently
    // hide it. The request continues under its normal policy; operators are alerted.
    recordAuditWriteFailure("mutation");
    try {
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    } catch {
      // Metrics and the structured failure log remain the bounded fallback signal.
    }
  }
}
