import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";

export type ReportActor = {
  userId: string | null;
  actorType: "person" | "api_key" | "system";
  apiKeyId?: string | null;
};

/** Append one registered audit action (`audit/actions.ts`). Never carries rate or cost data (TC-11). */
export async function auditReport(
  tx: Executor,
  input: {
    action: string;
    workspaceId: string;
    entityType: string;
    entityId: string;
    actor: ReportActor;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  await appendAuditLog(tx, {
    actorId: input.actor.userId,
    actorType: input.actor.actorType,
    apiKeyId: input.actor.apiKeyId ?? null,
    workspaceId: input.workspaceId,
    projectId: null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}
