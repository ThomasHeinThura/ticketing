import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";

export type TimeActor = {
  userId: string | null;
  actorType: "person" | "api_key" | "system";
  apiKeyId?: string | null;
  auditOrigin?: "mcp";
};

/**
 * Append one registered audit action (`audit/actions.ts`). Time entries are audited without the
 * snapshotted rate: an audit reader must not learn a salary from a time entry (TC-11). A rate
 * change is audited too, but its row records only that a rate was set (who, which person and
 * project, the effective date); the amount and currency are not stored in the audit log.
 */
export async function auditTime(
  tx: Executor,
  input: {
    action: string;
    workspaceId: string;
    projectId?: string | null;
    entityType: string;
    entityId: string;
    actor: TimeActor;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  await appendAuditLog(tx, {
    actorId: input.actor.userId,
    actorType: input.actor.actorType,
    apiKeyId: input.actor.apiKeyId ?? null,
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after
      ? {
          ...input.after,
          ...(input.actor.auditOrigin
            ? { origin: input.actor.auditOrigin }
            : {}),
        }
      : input.actor.auditOrigin
        ? { origin: input.actor.auditOrigin }
        : null) as never,
  });
}
