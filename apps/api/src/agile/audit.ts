import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";

export type AgileActor = {
  userId: string;
  personId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

type Json = Record<string, unknown>;

/**
 * Append one audit row for an agile mutation. The action must be registered in
 * `audit/actions.ts` (the writer throws for an unknown action, so a missing registration fails
 * loudly instead of silently dropping the trail). The project id is recorded so reads are
 * reach-filtered (AU-10).
 */
export async function auditAgile(
  tx: Executor,
  input: {
    action: string;
    workspaceId: string;
    projectId: string;
    entityType: string;
    entityId: string;
    actor: AgileActor;
    before?: Json | null;
    after?: Json | null;
  },
) {
  await appendAuditLog(tx, {
    actorId: input.actor.userId,
    actorType: input.actor.actorType,
    apiKeyId: input.actor.apiKeyId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}
